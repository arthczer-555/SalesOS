/**
 * Dispatcher des agents planifiés, appelé toutes les 10 min par
 * netlify/functions/agents-dispatch-scheduled. C'est lui qui fait de chaque
 * agent une "fonction récurrente" sans qu'aucun cron ne soit créé par agent :
 * un seul cron, et next_run_at en base porte le planning de chacun.
 *
 *  1. Clôt les runs bloqués (process tué) pour qu'ils n'affichent pas
 *     "Running" à vie.
 *  2. Pour chaque agent actif échu : avance next_run_at à l'occurrence
 *     suivante (UPDATE conditionnel = verrou, deux dispatchers concurrents ne
 *     lancent jamais deux fois le même créneau), crée le run, déclenche le
 *     worker.
 *
 * Un créneau manqué (panne, déploiement) est rattrapé une seule fois au
 * passage suivant, pas autant de fois qu'il y a eu de créneaux.
 */

import { db } from "@/lib/db";
import { computeNextRun } from "./schedule";
import type { AgentRow } from "./types";
import { triggerAgentRun } from "./trigger";
import { activeSubscribers } from "./subscriptions";
import { catchUpBatchRecaps, fanOutAudience } from "./fanout";

const STUCK_AFTER_MS = 20 * 60 * 1000;
const BATCH = 25;

export async function dispatchDueAgents(origin: string): Promise<{ dispatched: number; reaped: number }> {
  const now = new Date();

  const { data: stuck } = await db
    .from("agent_runs")
    .update({
      status: "error",
      error: "The run was interrupted before finishing. It will run again at the next scheduled time.",
      finished_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .in("status", ["queued", "running"])
    .lt("updated_at", new Date(now.getTime() - STUCK_AFTER_MS).toISOString())
    .select("id");

  // Récaps d'envois groupés dont un run a été tué avant la fin.
  await catchUpBatchRecaps();

  // Même filet pour un design dont le process a été tué.
  await db
    .from("agents")
    .update({ design_status: "error", design_error: "The design was interrupted. Try again." })
    .eq("design_status", "designing")
    .lt("updated_at", new Date(now.getTime() - STUCK_AFTER_MS).toISOString());

  const { data: due, error } = await db
    .from("agents")
    // "*" : `shared` n'existe qu'après la migration agents_sharing.sql.
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`agents select failed: ${error.message}`);

  let dispatched = 0;
  for (const agent of (due ?? []) as AgentRow[]) {
    const next = computeNextRun(agent.schedule, now).toISOString();
    const { data: claimed } = await db
      .from("agents")
      .update({ next_run_at: next })
      .eq("id", agent.id)
      .eq("status", "active")
      .eq("next_run_at", agent.next_run_at)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    // Agent à audience : envoi groupé (audience résolue maintenant), à la place
    // du run de l'owner. Sinon un run pour l'owner. Puis un par collègue abonné
    // (exécuté avec SON identité, livré dans SON DM). Un agent repassé en
    // personnel ne tourne plus pour ses abonnés.
    if (agent.destination.type === "audience") {
      const res = await fanOutAudience(agent, "scheduled", origin);
      if (res.ok) dispatched += res.runs;
      else console.error(`[agents/dispatch] group send failed for ${agent.id}:`, res.error);
    }
    const subscribers = agent.shared === true ? await activeSubscribers(agent.id) : [];
    const targets: (string | null)[] = [
      ...(agent.destination.type === "audience" ? [] : [null]),
      ...subscribers.map((s) => s.user_id).filter((u) => u !== agent.owner_id),
    ];
    for (const runAs of targets) {
      const { data: run, error: runErr } = await db
        .from("agent_runs")
        .insert({ agent_id: agent.id, owner_id: agent.owner_id, kind: "scheduled", deliver: true, ...(runAs ? { run_as_user_id: runAs } : {}) })
        .select("id")
        .single<{ id: string }>();
      if (runErr || !run) {
        console.error(`[agents/dispatch] run insert failed for ${agent.id}${runAs ? ` (for ${runAs})` : ""}:`, runErr?.message);
        continue;
      }
      try {
        await triggerAgentRun(origin, run.id);
        dispatched++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[agents/dispatch] trigger failed for ${agent.id}:`, message);
        await db
          .from("agent_runs")
          .update({ status: "error", error: "Could not start the run. It will run again at the next scheduled time.", finished_at: new Date().toISOString() })
          .eq("id", run.id);
      }
    }
  }

  return { dispatched, reaped: stuck?.length ?? 0 };
}
