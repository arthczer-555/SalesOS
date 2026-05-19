import type { Context } from "@netlify/functions";
import { runAdsAgent } from "../../lib/intel/agents/ads";
import { logAgentRun } from "../../lib/intel/log-agent-run";
import { db } from "../../lib/db";

// Background function : 30 sociétés Radar x getCompanyAds Netrows + dedup,
// budget 15 min vs ~26s sync.
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
    const result = await runAdsAgent();
    signalsCount = result.signalsCount;
    payload = result;
  } catch (e) {
    ok = false;
    errorText = e instanceof Error ? e.message : String(e);
    console.error("[intel-ads-background] failed:", e);
  }

  if (userId) {
    const { error: upsertErr } = await db.from("intel_agent_runs").upsert(
      {
        user_id: userId,
        agent_id: "ads-activity",
        last_run_at: startedAt,
        last_run_status: ok ? "ok" : "error",
        last_run_signals_count: signalsCount,
        last_run_error: errorText,
      },
      { onConflict: "user_id,agent_id" },
    );
    if (upsertErr) {
      console.error("[intel-ads-background] intel_agent_runs upsert failed:", upsertErr);
    }
  }

  await logAgentRun({
    agentId: "ads-activity",
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
