/**
 * Exécution d'un agent (un run) : la MÊME boucle agentique que CoachelloAI
 * (lib/chat/loop.ts), avec les outils des sources cochées, puis livraison
 * Slack. Appelée par la Background Function agents-run-background (planifié,
 * "Run now", aperçu) ou inline en local.
 *
 * Contrat : une row agent_runs ne reste jamais bloquée en queued/running. Le
 * worker écrit sa progression (étapes d'outils, sources) en throttlé pour que
 * l'éditeur l'affiche en direct, bat un heartbeat, et se coupe lui-même avant
 * la limite de 15 min de Netlify.
 */

import { db } from "@/lib/db";
import { runLoop, estimateCost } from "@/lib/chat/loop";
import { chatToolLabel } from "@/lib/chat/tool-labels";
import type { ChatEvent } from "@/lib/chat/events";
import { friendlyErrorMessage } from "@/lib/credit-error";
import { logUsage } from "@/lib/log-usage";
import { stripEmDashes } from "@/lib/no-em-dash";
import { agentClient, agentsModel } from "./claude";
import { buildAgentSystem } from "./prompt";
import { toolsForSources } from "./tools";
import { deliverAgentMessage } from "./slack";
import { extractMissingTools, extractRecap, mergeMissingTools, missingToolFooter } from "./missing-tools";
import { stampSubscription } from "./subscriptions";
import { resolveAudience } from "./audience";
import { maybeSendBatchRecap } from "./fanout";
import { SKIP_MARKER, type AgentRow, type AgentRunRow, type AgentRunSource, type AgentToolStep } from "./types";
import { canSeeOthersRuns } from "./access";

const MIN_FLUSH_MS = 1200;
const HEARTBEAT_MS = 10_000;
// Bien en dessous des 15 min Netlify : le run est clos proprement en erreur
// plutôt que tué en plein vol.
const WATCHDOG_MS = 9 * 60 * 1000;

type RunContext = Pick<AgentRunRow, "id" | "agent_id" | "owner_id" | "kind" | "status" | "deliver" | "run_as_user_id" | "batch_id">;

async function updateRun(runId: string, patch: Partial<AgentRunRow>): Promise<void> {
  await db
    .from("agent_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .then(undefined, () => {});
}

/**
 * Exécute le run `runId`. Idempotent : un run qui n'est plus "queued" n'est
 * pas rejoué (double déclenchement du dispatcher, retry Netlify).
 */
export async function runAgentJob(runId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: claimed } = await db
    .from("agent_runs")
    .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued")
    // select("*") : run_as_user_id n'existe qu'après la migration
    // agents_subscriptions.sql, le nommer casserait tous les runs avant elle.
    .select("*")
    .maybeSingle<RunContext>();
  if (!claimed) return { ok: true };

  const startedAt = Date.now();
  let toolSteps: AgentToolStep[] = [];
  let sources: AgentRunSource[] = [];
  let lastFlushAt = 0;
  let flushing: Promise<void> | null = null;
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && (flushing || now - lastFlushAt < MIN_FLUSH_MS)) return;
    lastFlushAt = now;
    flushing = updateRun(runId, { tool_steps: toolSteps, sources }).finally(() => {
      flushing = null;
    });
  };
  const heartbeat = setInterval(() => void updateRun(runId, {}), HEARTBEAT_MS);

  let agent: AgentRow | null = null;
  let creatorName: string | null = null;
  try {
    const { data: agentRow, error: agentErr } = await db.from("agents").select("*").eq("id", claimed.agent_id).single<AgentRow>();
    if (agentErr || !agentRow) throw new Error("Agent not found.");
    agent = agentRow;
    // Pour qui ce run s'exécute : l'owner, ou un collègue (abonné / "Run for
    // me" depuis l'onglet Team). Identité, clé Claude, coût, DM et "depuis la
    // dernière fois" sont alors ceux du collègue.
    const runAs = claimed.run_as_user_id ?? agent.owner_id;
    const isOwnerRun = runAs === agent.owner_id;
    const audience = agent.destination.type === "audience" ? agent.destination : null;
    const isBatch = !!claimed.batch_id;
    type UserCtx = { name: string | null; email: string; hubspot_owner_id: string | null };
    const [{ data: owner }, { data: creator }, lastDelivered] = await Promise.all([
      db.from("users").select("name, email, hubspot_owner_id").eq("id", runAs).single<UserCtx>(),
      db.from("users").select("name, email, is_admin").eq("id", agent.owner_id).maybeSingle<Pick<UserCtx, "name" | "email"> & { is_admin: boolean | null }>(),
      isOwnerRun ? Promise.resolve(null) : lastDeliveryFor(agent.id, runAs),
    ]);
    if (!owner) throw new Error(isOwnerRun ? "The agent's owner no longer exists." : "The user this run is for no longer exists.");
    const ownerName = creator?.name ?? creator?.email ?? "a teammate";
    creatorName = isOwnerRun ? null : ownerName;
    // Ce que le modèle écrit ici à partir des données de runAs peut-il
    // remonter au créateur (récap, outils manquants) ? Oui pour son propre run
    // ou un créateur admin (lib/agents/access.ts, canSeeOthersRuns).
    const creatorMaySee = isOwnerRun || canSeeOthersRuns({ is_admin: !!creator?.is_admin });
    // Envoi groupé personnalisé : résumé d'une ligne pour le récap du créateur
    // (sinon le récap dit juste "sent").
    const wantsRecap = isBatch && !!audience?.personalize && creatorMaySee;

    const [client, model] = await Promise.all([agentClient(runAs, `Agent "${agent.name}"`), agentsModel()]);
    const now = new Date();
    const system = await buildAgentSystem({
      agent,
      owner: { name: owner.name, email: owner.email, hubspotOwnerId: owner.hubspot_owner_id },
      now,
      ...(isOwnerRun ? {} : { creatorName, forceDm: true, lastDeliveredAt: lastDelivered }),
      ...(wantsRecap ? { batchRecapFor: ownerName } : {}),
    });
    // Agent envoyé à une audience : jamais la boîte Gmail d'un collègue.
    const tools = toolsForSources(agent.sources, { noGmail: !!audience });

    const onEvent = (event: ChatEvent) => {
      if (event.type === "tool") {
        toolSteps = [...toolSteps, { name: event.name, label: chatToolLabel(event.name) }];
      } else if (event.type === "tool_progress") {
        const last = toolSteps[toolSteps.length - 1];
        toolSteps = last ? [...toolSteps.slice(0, -1), { name: last.name, label: event.message }] : [{ name: null, label: event.message }];
      } else if (event.type === "source") {
        if (!sources.some((s) => s.kind === event.source.kind && s.title === event.source.title)) {
          sources = [...sources, event.source];
        }
      } else {
        return;
      }
      flush();
    };

    const TIMED_OUT = Symbol("timeout");
    const result = await Promise.race([
      runLoop({
        client,
        model,
        system,
        tools: tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t)),
        messages: [
          {
            role: "user",
            content: `Exécute ta tâche maintenant (${now.toISOString().slice(0, 10)}) et écris le message final, prêt à être publié.`,
          },
        ],
        toolContext: { userId: runAs, userOwnerId: owner.hubspot_owner_id, userEmail: owner.email },
        emit: onEvent,
        allowedTools: new Set(tools.map((t) => t.name)),
      }),
      new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), WATCHDOG_MS)),
    ]);
    if (result === TIMED_OUT) {
      throw new Error("The agent ran for too long and was stopped. Narrow the instructions (fewer accounts, shorter period) and try again.");
    }

    const costEquivalentInput = Math.round(result.inputTokens + result.cacheWriteTokens * 1.25 + result.cacheReadTokens * 0.1);
    logUsage(runAs, model, costEquivalentInput, result.outputTokens, "agents");
    const cost = estimateCost(model, {
      input: result.inputTokens,
      cacheWrite: result.cacheWriteTokens,
      cacheRead: result.cacheReadTokens,
      output: result.outputTokens,
    });

    // Outils manquants : marqueurs retirés du message, remplacés par une ligne
    // standard "Ask Arthur" en pied, et mémorisés sur l'agent pour l'éditeur.
    const { clean: withoutRecap, recap } = extractRecap(stripEmDashes(result.finalText));
    const { clean, items: missing } = extractMissingTools(withoutRecap);
    const footer = missingToolFooter(missing);
    const output = [clean, footer].filter(Boolean).join("\n\n").trim();
    if (!output) throw new Error("The agent produced an empty message.");
    const skipped = clean.includes(SKIP_MARKER) && clean.replace(SKIP_MARKER, "").trim().length < 40;
    // Un run "rien à signaler" n'a pas forcément tout parcouru : il ne
    // tranche pas sur les manques connus. Un run pour un collègue (abonné) peut
    // buter sur SES accès : il ne touche pas la liste. Un run d'envoi groupé
    // ajoute ses manques (si le créateur peut voir ce run) ; l'owner, ou un
    // admin en "Preview as", la tient.
    if (!skipped) {
      if (isBatch && creatorMaySee) await syncMissingTools(agent.id, missing, { replace: false });
      else if (!isBatch && (isOwnerRun || (audience && claimed.kind === "preview"))) await syncMissingTools(agent.id, missing, { replace: true });
    }

    let delivery: Awaited<ReturnType<typeof deliverAgentMessage>> | null = null;
    let deliveryError: string | null = null;
    let deliveries: NonNullable<AgentRunRow["deliveries"]> | null = null;
    if (claimed.deliver && !skipped && audience && !audience.personalize) {
      // Envoi identique : le même message en DM à chaque membre de l'audience.
      deliveries = [];
      for (const m of await resolveAudience(audience)) {
        try {
          const d = await deliverAgentMessage(agent, output, m.id === agent.owner_id ? {} : { dmUserId: m.id, sharedBy: ownerName });
          deliveries.push({ user_id: m.id, ok: true, permalink: d.permalink });
          if (m.id === agent.owner_id || !delivery) delivery = d;
        } catch (e) {
          deliveries.push({ user_id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (deliveries.length > 0 && deliveries.every((d) => !d.ok)) deliveryError = "The message could not be delivered to anyone (see the recap).";
    } else if (claimed.deliver && !skipped) {
      try {
        delivery = await deliverAgentMessage(agent, output, isOwnerRun ? {} : { dmUserId: runAs, sharedBy: creatorName });
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    }

    clearInterval(heartbeat);
    await flushing;
    const finishedAt = new Date().toISOString();
    const status = deliveryError ? "error" : skipped ? "skipped" : "success";
    await updateRun(runId, {
      status,
      output: skipped ? null : output,
      error: deliveryError,
      tool_steps: toolSteps,
      sources,
      model,
      input_tokens: costEquivalentInput,
      output_tokens: result.outputTokens,
      cost_usd: Math.round(cost * 10_000) / 10_000,
      slack_channel: delivery?.channel ?? null,
      slack_ts: delivery?.ts ?? null,
      slack_permalink: delivery?.permalink ?? null,
      delivered_at: delivery ? finishedAt : null,
      finished_at: finishedAt,
      // Champs de la migration agents_audience.sql : seulement pour un envoi groupé.
      // recap_line ignorée si elle n'a pas été demandée : des consignes ne
      // peuvent pas la forcer pour faire sortir des données vers le créateur.
      ...(isBatch ? { recap_line: skipped || !wantsRecap ? null : recap, ...(deliveries ? { deliveries } : {}) } : {}),
    });
    // Un envoi groupé met l'agent à jour une fois, avec le récap.
    if (isBatch) await maybeSendBatchRecap(claimed.batch_id!);
    else if (isOwnerRun) await stampAgent(agent, claimed, status, delivery ? finishedAt : null);
    else if (claimed.kind !== "preview") await stampSubscription(agent.id, runAs, status, delivery ? finishedAt : null);
    console.log(`[agents/run] ${agent.id} ${claimed.kind} ${status} in ${Math.round((Date.now() - startedAt) / 1000)}s, $${cost.toFixed(3)}`);
    return deliveryError ? { ok: false, error: deliveryError } : { ok: true };
  } catch (e) {
    clearInterval(heartbeat);
    await flushing;
    const message = friendlyErrorMessage(e instanceof Error ? e.message : String(e));
    await updateRun(runId, { status: "error", error: message, tool_steps: toolSteps, sources, finished_at: new Date().toISOString() });
    if (claimed.batch_id) await maybeSendBatchRecap(claimed.batch_id);
    else if (agent) {
      const runAs = claimed.run_as_user_id ?? agent.owner_id;
      if (runAs === agent.owner_id) await stampAgent(agent, claimed, "error", null);
      else if (claimed.kind !== "preview") await stampSubscription(agent.id, runAs, "error", null);
    }
    console.error(`[agents/run] ${claimed.agent_id} failed:`, message);
    return { ok: false, error: message };
  }
}

/**
 * Après un run abouti, la liste des outils manquants de l'agent devient
 * exactement celle que le run a signalée : le prompt lui fait revérifier
 * chaque manque connu avec ses outils actuels, donc un manque non resignalé
 * est résolu (un outil a été ajouté depuis) et disparaît de l'éditeur. Les
 * dates de découverte et de demande à Arthur sont conservées pour ceux qui
 * restent. Relit design_notes juste avant d'écrire : un design a pu passer.
 */
async function syncMissingTools(agentId: string, items: { need: string; reason: string }[], opts: { replace: boolean }): Promise<void> {
  const { data } = await db.from("agents").select("design_notes").eq("id", agentId).maybeSingle<Pick<AgentRow, "design_notes">>();
  const notes = data?.design_notes ?? { assumptions: [], source_reasons: [] };
  if (items.length === 0 && (!opts.replace || !notes.missing_tools?.length)) return;
  const next = { ...notes, missing_tools: mergeMissingTools(notes.missing_tools, items, "run", { replace: opts.replace }) };
  const { error } = await db.from("agents").update({ design_notes: next }).eq("id", agentId);
  if (error) console.warn(`[agents/run] could not sync missing tools for ${agentId}:`, error.message);
}

/**
 * Dernière livraison réussie de cet agent à cette personne (abonné, membre
 * d'une audience) : borne "depuis la dernière fois" de SES messages.
 */
async function lastDeliveryFor(agentId: string, userId: string): Promise<string | null> {
  const { data } = await db
    .from("agent_runs")
    .select("delivered_at")
    .eq("agent_id", agentId)
    .eq("run_as_user_id", userId)
    .not("delivered_at", "is", null)
    .order("delivered_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.delivered_at as string | undefined) ?? null;
}

/** Met à jour le résumé "dernier run" de l'agent (hors aperçus). */
async function stampAgent(agent: AgentRow, run: RunContext, status: string, deliveredAt: string | null): Promise<void> {
  if (run.kind === "preview") return;
  const patch: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    last_run_status: status,
    run_count: (agent.run_count ?? 0) + 1,
  };
  if (deliveredAt) patch.last_delivered_at = deliveredAt;
  await db.from("agents").update(patch).eq("id", agent.id).then(undefined, () => {});
}

/**
 * Livre sur Slack la sortie d'un aperçu déjà calculé ("Send to Slack" sous
 * l'aperçu) : pas de nouveau calcul, pas de nouveau coût.
 */
export async function deliverExistingRun(agent: AgentRow, run: AgentRunRow): Promise<AgentRunRow> {
  if (!run.output) throw new Error("This run has no message to send.");
  const runAs = run.run_as_user_id ?? agent.owner_id;
  const isOwnerRun = runAs === agent.owner_id;
  let sharedBy: string | null = null;
  if (!isOwnerRun) {
    const { data: creator } = await db.from("users").select("name, email").eq("id", agent.owner_id).maybeSingle();
    sharedBy = (creator?.name as string | null) ?? (creator?.email as string | null) ?? null;
  }
  const delivery = await deliverAgentMessage(agent, run.output, isOwnerRun ? {} : { dmUserId: runAs, sharedBy });
  const deliveredAt = new Date().toISOString();
  const patch = {
    slack_channel: delivery.channel,
    slack_ts: delivery.ts,
    slack_permalink: delivery.permalink,
    delivered_at: deliveredAt,
  };
  await updateRun(run.id, patch);
  if (isOwnerRun) await db.from("agents").update({ last_delivered_at: deliveredAt }).eq("id", agent.id).then(undefined, () => {});
  return { ...run, ...patch };
}
