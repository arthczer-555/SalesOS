import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface AgentRunLog {
  id: string;
  agent_id: string;
  triggered_by: "manual" | "cron";
  user_id: string | null;
  user_name: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: "ok" | "error" | "partial";
  signals_count: number;
  error: string | null;
}

export interface AgentLogsResponse {
  logs: AgentRunLog[];
  errorCount24h: number;
  errorCount7d: number;
}

// GET /api/intel/agents/logs?status=error&agent=<id>&limit=100
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const agentId = url.searchParams.get("agent");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  let q = db
    .from("intel_agent_run_logs")
    .select("id, agent_id, triggered_by, user_id, started_at, finished_at, duration_ms, status, signals_count, error")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (status && ["ok", "error", "partial"].includes(status)) {
    q = q.eq("status", status);
  }
  if (agentId) {
    q = q.eq("agent_id", agentId);
  }

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set((rows ?? []).map((r) => r.user_id).filter((id): id is string => !!id)),
  );
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await db.from("users").select("id, name, email").in("id", userIds);
    for (const u of users ?? []) {
      userMap.set(u.id, u.name ?? u.email ?? u.id);
    }
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: errorCount24h }, { count: errorCount7d }] = await Promise.all([
    db
      .from("intel_agent_run_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("started_at", since24h),
    db
      .from("intel_agent_run_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("started_at", since7d),
  ]);

  const logs: AgentRunLog[] = (rows ?? []).map((r) => ({
    id: r.id,
    agent_id: r.agent_id,
    triggered_by: r.triggered_by,
    user_id: r.user_id,
    user_name: r.user_id ? userMap.get(r.user_id) ?? null : null,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_ms: r.duration_ms,
    status: r.status,
    signals_count: r.signals_count ?? 0,
    error: r.error,
  }));

  const response: AgentLogsResponse = {
    logs,
    errorCount24h: errorCount24h ?? 0,
    errorCount7d: errorCount7d ?? 0,
  };
  return NextResponse.json(response);
}
