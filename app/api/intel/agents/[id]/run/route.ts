import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { AGENT_BY_ID } from "@/lib/intel-agents";
import type { AgentId } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

// Job-change tourne en push (webhook Netrows), pas de run manuel possible.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const def = AGENT_BY_ID[id as AgentId];
  if (!def) return NextResponse.json({ error: "Agent inconnu" }, { status: 404 });
  return NextResponse.json(
    { error: "Cet agent fonctionne en push, pas de run manuel." },
    { status: 400 },
  );
}
