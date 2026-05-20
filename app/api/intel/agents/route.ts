import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENTS } from "@/lib/intel-agents";
import type { Agent, AgentRunMetadata, AgentId } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

// Netlify Background Functions sont tuées à 15 min. Si la BG fn meurt avant
// d'écrire son statut final, la ligne intel_agent_runs reste "running" sans
// limite. On requalifie ces lignes en "error" côté lecture pour que l'UI ne
// reste pas bloquée sur "En cours".
const STALE_RUNNING_MS = 16 * 60 * 1000;

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: runs } = await db
    .from("intel_agent_runs")
    .select("agent_id, enabled, last_run_at, last_run_status, last_run_signals_count, last_run_error, config")
    .eq("user_id", user.id);

  const now = Date.now();
  const runsByAgent = new Map<string, AgentRunMetadata>();
  for (const r of runs ?? []) {
    let status = r.last_run_status as AgentRunMetadata["last_run_status"];
    let error = r.last_run_error as string | null;
    if (status === "running" && r.last_run_at) {
      const age = now - new Date(r.last_run_at).getTime();
      if (Number.isFinite(age) && age > STALE_RUNNING_MS) {
        status = "error";
        error = error ?? "Background function timeout (>15min). No final status logged.";
      }
    }

    runsByAgent.set(r.agent_id, {
      enabled: r.enabled ?? true,
      last_run_at: r.last_run_at,
      last_run_status: status,
      last_run_signals_count: r.last_run_signals_count ?? 0,
      last_run_error: error,
      config: r.config,
    });
  }

  // Compute weekly intel counts in one go
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: weekly } = await db
    .from("market_signals")
    .select("agent_id")
    .eq("user_id", user.id)
    .gte("created_at", cutoff)
    .eq("archived", false);

  const weeklyCount = new Map<string, number>();
  for (const w of weekly ?? []) {
    if (!w.agent_id) continue;
    weeklyCount.set(w.agent_id, (weeklyCount.get(w.agent_id) ?? 0) + 1);
  }

  const agents: Agent[] = AGENTS.map((def) => ({
    ...def,
    enabled: runsByAgent.get(def.id)?.enabled ?? true,
    last_run_at: runsByAgent.get(def.id)?.last_run_at ?? null,
    last_run_status: runsByAgent.get(def.id)?.last_run_status ?? null,
    last_run_signals_count: runsByAgent.get(def.id)?.last_run_signals_count ?? 0,
    last_run_error: runsByAgent.get(def.id)?.last_run_error ?? null,
    config: runsByAgent.get(def.id)?.config ?? null,
    weeklyIntelsCount: weeklyCount.get(def.id) ?? 0,
  }));

  return NextResponse.json({ agents });
}
