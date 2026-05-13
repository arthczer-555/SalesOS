import { db } from "../db";

export type AgentRunStatus = "ok" | "error" | "partial";
export type AgentRunTrigger = "manual" | "cron";

export interface LogAgentRunArgs {
  agentId: string;
  triggeredBy: AgentRunTrigger;
  userId: string | null;
  startedAt: string;                 // ISO timestamp
  status: AgentRunStatus;
  signalsCount: number;
  error: string | null;
  payload?: unknown;
}

export async function logAgentRun(args: LogAgentRunArgs): Promise<void> {
  const finishedAt = new Date();
  const startedAtMs = new Date(args.startedAt).getTime();
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, finishedAt.getTime() - startedAtMs)
    : null;

  const { error } = await db.from("intel_agent_run_logs").insert({
    agent_id: args.agentId,
    triggered_by: args.triggeredBy,
    user_id: args.userId,
    started_at: args.startedAt,
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    status: args.status,
    signals_count: args.signalsCount,
    error: args.error?.slice(0, 4000) ?? null,
    payload: args.payload ?? null,
  });

  if (error) {
    console.warn("[log-agent-run] insert failed:", error.message);
  }
}
