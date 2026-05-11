import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { AgentId, IntelStats } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function periodToCutoff(period: string | null): string | null {
  const now = Date.now();
  switch (period) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const agents = searchParams.getAll("agent");
  const scoreMin = parseInt(searchParams.get("score_min") ?? "0", 10);
  const period = searchParams.get("period");
  const status = searchParams.get("status") ?? "all";
  const q = searchParams.get("q")?.trim() ?? "";
  const cursor = parseInt(searchParams.get("cursor") ?? "0", 10);

  const cutoff = periodToCutoff(period);

  // Base query for the listing
  let query = db
    .from("market_signals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(cursor, cursor + PAGE_SIZE - 1);

  if (agents.length > 0) query = query.in("agent_id", agents as AgentId[]);
  if (scoreMin > 0) query = query.gte("score", scoreMin);
  if (cutoff) query = query.gte("created_at", cutoff);
  if (q) query = query.or(`title.ilike.%${q}%,company_name.ilike.%${q}%,summary.ilike.%${q}%`);

  if (status === "unread") query = query.eq("is_read", false).eq("archived", false);
  else if (status === "actionable") query = query.gte("score", 70).eq("is_actioned", false).eq("archived", false);
  else if (status === "archived") query = query.eq("archived", true);
  else query = query.eq("archived", false);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // KPI counters (independent of filters except archived flag)
  const baseStats = db.from("market_signals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("archived", false);
  const [totalRes, unreadRes, actionableRes] = await Promise.all([
    baseStats,
    db.from("market_signals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("archived", false).eq("is_read", false),
    db.from("market_signals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("archived", false).eq("is_actioned", false).gte("score", 70),
  ]);

  const stats: IntelStats = {
    total: totalRes.count ?? 0,
    unread: unreadRes.count ?? 0,
    actionable: actionableRes.count ?? 0,
  };

  return NextResponse.json({
    intels: rows ?? [],
    stats,
    nextCursor: (rows?.length ?? 0) === PAGE_SIZE ? cursor + PAGE_SIZE : null,
  });
}
