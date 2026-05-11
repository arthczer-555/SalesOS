import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENT_BY_ID } from "@/lib/intel-agents";
import type { AgentId } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const def = AGENT_BY_ID[id as AgentId];
  if (!def) return NextResponse.json({ error: "Agent inconnu" }, { status: 404 });
  if (!def.runEndpoint) {
    return NextResponse.json({ error: "Cet agent fonctionne en push, pas de run manuel." }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  await db
    .from("intel_agent_runs")
    .upsert(
      { user_id: user.id, agent_id: id, last_run_status: "partial" },
      { onConflict: "user_id,agent_id" }
    );

  // Forward request to the actual runner endpoint (relative path on the same app)
  try {
    const baseUrl = req.nextUrl.origin;
    const cookie = req.headers.get("cookie") ?? "";
    const res = await fetch(`${baseUrl}${def.runEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 200) };
    }
    const ok = res.ok;
    const signalsCount =
      (payload && typeof payload === "object" && "signalsCount" in payload && typeof (payload as { signalsCount: unknown }).signalsCount === "number"
        ? (payload as { signalsCount: number }).signalsCount
        : 0);

    await db
      .from("intel_agent_runs")
      .upsert(
        {
          user_id: user.id,
          agent_id: id,
          last_run_at: startedAt,
          last_run_status: ok ? "ok" : "error",
          last_run_signals_count: signalsCount,
          last_run_error: ok ? null : String(text).slice(0, 500),
        },
        { onConflict: "user_id,agent_id" }
      );

    return NextResponse.json({ ok, payload });
  } catch (e) {
    await db
      .from("intel_agent_runs")
      .upsert(
        {
          user_id: user.id,
          agent_id: id,
          last_run_at: startedAt,
          last_run_status: "error",
          last_run_error: e instanceof Error ? e.message : String(e),
        },
        { onConflict: "user_id,agent_id" }
      );
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
