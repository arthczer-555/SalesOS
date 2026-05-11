import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENT_BY_ID } from "@/lib/intel-agents";
import type { AgentId } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  if (!AGENT_BY_ID[id as AgentId]) {
    return NextResponse.json({ error: "Agent inconnu" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const upsert: Record<string, unknown> = {
    user_id: user.id,
    agent_id: id,
  };
  if (typeof body.enabled === "boolean") upsert.enabled = body.enabled;
  if (body.config && typeof body.config === "object") upsert.config = body.config;

  const { data, error } = await db
    .from("intel_agent_runs")
    .upsert(upsert, { onConflict: "user_id,agent_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ run: data });
}
