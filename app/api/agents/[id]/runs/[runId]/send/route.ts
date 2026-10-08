import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAgent } from "@/lib/agents/access";
import { deliverExistingRun } from "@/lib/agents/run";
import type { AgentRunRow } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/runs/[runId]/send : poste sur Slack le message d'un
// aperçu déjà calculé ("Send to Slack" sous l'aperçu). Aucun nouvel appel IA.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id, runId } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const { data: run } = await db.from("agent_runs").select("*").eq("id", runId).eq("agent_id", id).maybeSingle<AgentRunRow>();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  // L'owner envoie ses runs ; tout autre utilisateur, admin compris,
  // seulement les siens (livrés dans son DM).
  const isOwner = access.agent.owner_id === user.id;
  const mine = isOwner ? !run.run_as_user_id || run.run_as_user_id === user.id : run.run_as_user_id === user.id;
  if (!mine) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "success" || !run.output) return NextResponse.json({ error: "This run has no message to send." }, { status: 409 });
  if (run.delivered_at) return NextResponse.json({ error: "Already sent to Slack." }, { status: 409 });

  try {
    const updated = await deliverExistingRun(access.agent, run);
    return NextResponse.json({ run: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Slack delivery failed" }, { status: 502 });
  }
}
