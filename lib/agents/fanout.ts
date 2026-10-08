/**
 * Envoi groupé d'un agent à audience ("Send to a group", tout utilisateur).
 *
 *  - Personnalisé : un run par destinataire (run_as_user_id), chacun dans sa
 *    Background Function, exécuté avec SES données et livré dans SON DM.
 *  - Identique : un seul run (pour le créateur), le même message livré en DM à
 *    chaque destinataire par lib/agents/run.ts (résultats dans `deliveries`).
 *
 * Un lot (agent_batches) regroupe l'envoi. Quand plus aucun run du lot ne
 * tourne, le récap part UNE fois au créateur (UPDATE conditionnel sur
 * recap_sent_at : deux runs qui finissent ensemble n'envoient pas deux récaps).
 * Le dispatcher rattrape les lots dont un run a été tué avant la fin.
 */

import { db } from "@/lib/db";
import { dmRecipient, lookupSlackIdByEmail } from "@/lib/slack/lookup";
import { resolveAudience } from "./audience";
import type { AudienceDestination } from "./audience-label";
import { triggerAgentRun } from "./trigger";
import type { AgentRow, AgentRunRow } from "./types";

type FanOutResult = { ok: true; batchId: string; runs: number; recipients: number } | { ok: false; error: string };

const pendingMigration = (message: string | undefined) => /agent_batches|batch_id|schema cache/i.test(message ?? "");

export async function fanOutAudience(agent: AgentRow, kind: "scheduled" | "manual", origin: string): Promise<FanOutResult> {
  if (agent.destination.type !== "audience") return { ok: false, error: "This agent is not sent to a group." };
  const dest: AudienceDestination = agent.destination;
  const members = await resolveAudience(dest);
  if (members.length === 0) return { ok: false, error: "The audience is empty: nobody matches the selected groups and people." };

  const { data: batch, error } = await db
    .from("agent_batches")
    .insert({ agent_id: agent.id, kind, personalized: dest.personalize, recipients: members.length })
    .select("id")
    .single<{ id: string }>();
  if (error || !batch) {
    return {
      ok: false,
      error: pendingMigration(error?.message) ? "Sending to a group needs a database update that isn't applied yet. Ask Arthur." : (error?.message ?? "Could not start the group send"),
    };
  }

  // Personnalisé : un run par membre (l'owner, s'il est membre, garde un run
  // "owner" sans run_as). Identique : un seul run owner.
  const runAsList: (string | null)[] = dest.personalize ? members.map((m) => (m.id === agent.owner_id ? null : m.id)) : [null];
  let runs = 0;
  for (const runAs of runAsList) {
    const { data: run, error: runErr } = await db
      .from("agent_runs")
      .insert({ agent_id: agent.id, owner_id: agent.owner_id, kind, deliver: true, batch_id: batch.id, ...(runAs ? { run_as_user_id: runAs } : {}) })
      .select("id")
      .single<{ id: string }>();
    if (runErr || !run) {
      console.error(`[agents/fanout] run insert failed for ${agent.id}${runAs ? ` (for ${runAs})` : ""}:`, runErr?.message);
      continue;
    }
    try {
      await triggerAgentRun(origin, run.id);
      runs++;
    } catch (e) {
      await db
        .from("agent_runs")
        .update({ status: "error", error: e instanceof Error ? e.message : "Could not start the run", finished_at: new Date().toISOString() })
        .eq("id", run.id);
    }
  }
  // Aucun run lancé : le récap le dira, sans attendre le rattrapage.
  if (runs === 0) await maybeSendBatchRecap(batch.id);
  return { ok: true, batchId: batch.id, runs, recipients: members.length };
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
}

const short = (s: string | null | undefined, n = 90) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Envoie le récap d'un lot si tous ses runs sont terminés, une seule fois, puis
 * met à jour le résumé "dernier run" de l'agent. Best-effort, ne throw jamais.
 */
export async function maybeSendBatchRecap(batchId: string): Promise<void> {
  try {
    const { data: open } = await db.from("agent_runs").select("id").eq("batch_id", batchId).in("status", ["queued", "running"]).limit(1);
    if (open && open.length > 0) return;

    const { data: batch } = await db
      .from("agent_batches")
      .update({ recap_sent_at: new Date().toISOString() })
      .eq("id", batchId)
      .is("recap_sent_at", null)
      .select("*")
      .maybeSingle<{ id: string; agent_id: string; personalized: boolean; recipients: number }>();
    if (!batch) return;

    const [{ data: agent }, { data: runRows }] = await Promise.all([
      db.from("agents").select("*").eq("id", batch.agent_id).maybeSingle<AgentRow>(),
      db.from("agent_runs").select("*").eq("batch_id", batchId),
    ]);
    if (!agent) return;
    const runs = (runRows ?? []) as AgentRunRow[];

    // Noms : owner, destinataires des runs, destinataires des envois identiques.
    const userIds = new Set<string>([agent.owner_id]);
    for (const r of runs) {
      if (r.run_as_user_id) userIds.add(r.run_as_user_id);
      for (const d of r.deliveries ?? []) userIds.add(d.user_id);
    }
    const { data: users } = await db.from("users").select("id, name, email, slack_user_id").in("id", [...userIds]);
    const byId = new Map((users ?? []).map((u) => [u.id as string, u as { id: string; name: string | null; email: string; slack_user_id: string | null }]));
    const nameOf = (id: string | null | undefined) => {
      const u = byId.get(id ?? agent.owner_id);
      return u?.name ?? u?.email ?? "Someone";
    };

    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    const lines: string[] = [];
    if (batch.personalized) {
      for (const r of [...runs].sort((a, b) => nameOf(a.run_as_user_id).localeCompare(nameOf(b.run_as_user_id)))) {
        const who = nameOf(r.run_as_user_id);
        if (r.status === "success" && r.delivered_at) {
          delivered++;
          lines.push(`• ${who}: ${short(r.recap_line) || "sent"}`);
        } else if (r.status === "skipped") {
          skipped++;
          lines.push(`• ${who}: _nothing to report, no message_`);
        } else {
          failed++;
          lines.push(`• ${who}: :warning: failed${r.error ? ` (${short(r.error, 70)})` : ""}`);
        }
      }
    } else {
      const run = runs[0];
      const deliveries = run?.deliveries ?? [];
      delivered = deliveries.filter((d) => d.ok).length;
      failed = deliveries.filter((d) => !d.ok).length;
      if (run?.status === "skipped") skipped = batch.recipients;
      if (run?.status === "error" && deliveries.length === 0) {
        failed = batch.recipients;
        lines.push(`• :warning: the message could not be generated${run.error ? ` (${short(run.error, 90)})` : ""}`);
      }
      for (const d of deliveries.filter((x) => !x.ok)) lines.push(`• ${nameOf(d.user_id)}: :warning: not delivered${d.error ? ` (${short(d.error, 70)})` : ""}`);
    }

    const url = appUrl();
    const headline = batch.personalized
      ? `${delivered} of ${batch.recipients} people got their message${skipped ? `, ${skipped} had nothing to report` : ""}${failed ? `, ${failed} failed` : ""}.`
      : skipped
        ? `Nothing to report: no message sent to the ${batch.recipients} people.`
        : `Sent to ${delivered}/${batch.recipients} people${failed ? `, ${failed} failed` : ""}.`;
    const text = [
      `${agent.emoji} *${agent.name}* · group send recap`,
      headline,
      ...(lines.length ? ["", ...lines] : []),
      ...(url ? ["", `<${url}/agents/${agent.id}?tab=runs|See the runs>`] : []),
    ].join("\n");

    const owner = byId.get(agent.owner_id);
    const memberId = owner?.slack_user_id || (owner?.email ? await lookupSlackIdByEmail(owner.email) : null);
    if (memberId) await dmRecipient(memberId, text).catch((e) => console.warn("[agents/fanout] recap DM failed:", e instanceof Error ? e.message : e));

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      last_run_at: now,
      last_run_status: delivered > 0 ? "success" : failed > 0 ? "error" : "skipped",
      run_count: (agent.run_count ?? 0) + 1,
    };
    if (delivered > 0) patch.last_delivered_at = now;
    await db.from("agents").update(patch).eq("id", agent.id).then(undefined, () => {});
  } catch (e) {
    console.error(`[agents/fanout] recap for batch ${batchId} failed:`, e instanceof Error ? e.message : e);
  }
}

/** Rattrapage (dispatcher) : lots terminés dont le récap n'est pas parti. */
export async function catchUpBatchRecaps(): Promise<void> {
  const { data, error } = await db
    .from("agent_batches")
    .select("id")
    .is("recap_sent_at", null)
    .lt("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
    .gt("created_at", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
    .limit(20);
  if (error) return; // migration agents_audience.sql pas encore appliquée
  for (const b of data ?? []) await maybeSendBatchRecap(b.id as string);
}
