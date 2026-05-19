import type { Context } from "@netlify/functions";
import { runCompetitorActivityAgent } from "../../lib/intel/agents/competitor-activity";
import { logAgentRun } from "../../lib/intel/log-agent-run";
import { db } from "../../lib/db";

// Background function : 20 profils concurrents x jusqu'à 3 pages de likes
// Netrows + dedup market_signals, budget 15 min vs ~26s sync.
//
// Auth : Bearer CRON_SECRET.
// Body : { userId: string | null, startedAt: string, triggeredBy: "manual" | "cron" }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { userId?: string | null; startedAt?: string; triggeredBy?: "manual" | "cron" } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  const userId = body.userId ?? null;
  const startedAt = body.startedAt ?? new Date().toISOString();
  const triggeredBy = body.triggeredBy ?? "cron";

  let ok = true;
  let errorText: string | null = null;
  let signalsCount = 0;
  let payload: unknown = null;

  try {
    const result = await runCompetitorActivityAgent({ callerUserId: userId });
    signalsCount = result.signalsCount;
    payload = result;
  } catch (e) {
    ok = false;
    errorText = e instanceof Error ? e.message : String(e);
    console.error("[intel-competitor-activity-background] failed:", e);
  }

  if (userId) {
    const { error: upsertErr } = await db.from("intel_agent_runs").upsert(
      {
        user_id: userId,
        agent_id: "competitor-activity",
        last_run_at: startedAt,
        last_run_status: ok ? "ok" : "error",
        last_run_signals_count: signalsCount,
        last_run_error: errorText,
      },
      { onConflict: "user_id,agent_id" },
    );
    if (upsertErr) {
      console.error("[intel-competitor-activity-background] intel_agent_runs upsert failed:", upsertErr);
    }
  }

  await logAgentRun({
    agentId: "competitor-activity",
    triggeredBy,
    userId,
    startedAt,
    status: ok ? "ok" : "error",
    signalsCount,
    error: errorText,
    payload,
  });

  return new Response(null, { status: 200 });
};
