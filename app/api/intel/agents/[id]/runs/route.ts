import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Historique simplifié : on retourne intel_agent_runs (état courant + dernier run)
// et on dérive un mini-historique depuis market_signals avec ce agent_id.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;

  const [{ data: state }, { data: signals }] = await Promise.all([
    db
      .from("intel_agent_runs")
      .select("*")
      .eq("user_id", user.id)
      .eq("agent_id", id)
      .maybeSingle(),
    db
      .from("market_signals")
      .select("id, title, score, created_at, signal_type, company_name")
      .eq("user_id", user.id)
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({ state, recentSignals: signals ?? [] });
}
