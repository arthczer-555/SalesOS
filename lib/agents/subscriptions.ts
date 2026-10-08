/**
 * Abonnements aux agents partagés (onglet Team). Un abonné reçoit l'agent d'un
 * collègue dans SON DM, à chaque échéance du planning de l'agent, exécuté avec
 * SON identité. La config reste celle de l'owner : ses modifications valent
 * pour tous les abonnés (contrairement à un "Duplicate").
 *
 * Tolérant à l'absence de la migration agents_subscriptions.sql : les lectures
 * renvoient vide, l'existant (agents de l'owner) continue de tourner.
 */

import { db } from "@/lib/db";

export type AgentSubscription = {
  agent_id: string;
  user_id: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_delivered_at: string | null;
  created_at: string;
};

let warned = false;
function missingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (!warned) {
    warned = true;
    console.warn("[agents/subscriptions] table unavailable (migration agents_subscriptions.sql applied?):", error.message);
  }
  return true;
}

/** Abonnés actifs d'un agent. */
export async function activeSubscribers(agentId: string): Promise<AgentSubscription[]> {
  const { data, error } = await db.from("agent_subscriptions").select("*").eq("agent_id", agentId).eq("active", true);
  if (missingTable(error)) return [];
  return (data ?? []) as AgentSubscription[];
}

export async function getSubscription(agentId: string, userId: string): Promise<AgentSubscription | null> {
  const { data, error } = await db.from("agent_subscriptions").select("*").eq("agent_id", agentId).eq("user_id", userId).maybeSingle();
  if (missingTable(error)) return null;
  return (data as AgentSubscription | null) ?? null;
}

/** Agents auxquels l'utilisateur est abonné (ids). */
export async function subscribedAgentIds(userId: string): Promise<Set<string>> {
  const { data, error } = await db.from("agent_subscriptions").select("agent_id").eq("user_id", userId).eq("active", true);
  if (missingTable(error)) return new Set();
  return new Set((data ?? []).map((r) => r.agent_id as string));
}

/** Nombre d'abonnés actifs par agent, pour une liste d'agents. */
export async function subscriberCounts(agentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (agentIds.length === 0) return counts;
  const { data, error } = await db.from("agent_subscriptions").select("agent_id").in("agent_id", agentIds).eq("active", true);
  if (missingTable(error)) return counts;
  for (const r of data ?? []) counts.set(r.agent_id as string, (counts.get(r.agent_id as string) ?? 0) + 1);
  return counts;
}

export async function setSubscription(agentId: string, userId: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db
    .from("agent_subscriptions")
    .upsert({ agent_id: agentId, user_id: userId, active }, { onConflict: "agent_id,user_id" });
  if (error) {
    return {
      ok: false,
      error: /agent_subscriptions|schema cache/i.test(error.message)
        ? "Subscriptions are not set up yet (database migration pending). Ask Arthur."
        : error.message,
    };
  }
  return { ok: true };
}

/** Résumé "dernier run" côté abonné. Best-effort. */
export async function stampSubscription(agentId: string, userId: string, status: string, deliveredAt: string | null): Promise<void> {
  const patch: Record<string, unknown> = { last_run_at: new Date().toISOString(), last_run_status: status };
  if (deliveredAt) patch.last_delivered_at = deliveredAt;
  await db.from("agent_subscriptions").update(patch).eq("agent_id", agentId).eq("user_id", userId).then(undefined, () => {});
}
