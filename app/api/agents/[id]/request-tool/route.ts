import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAgent } from "@/lib/agents/access";
import { notifyNewIdea } from "@/lib/ideas/notify";
import { IDEA_MAX_LENGTH } from "@/lib/ideas/types";
import type { AgentRow } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/request-tool : "Ask Arthur to build it". Les outils
// manquants de l'agent pas encore demandés partent dans la boîte à idées
// (table ideas, lue dans /admin/ideas) avec le DM Slack habituel à Arthur,
// puis sont marqués demandés pour ne pas renvoyer la même demande.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Only the agent's owner can request a tool." }, { status: 403 });

  const { agent } = access;
  const all = agent.design_notes?.missing_tools ?? [];
  const pending = all.filter((m) => !m.requested_at);
  if (pending.length === 0) return NextResponse.json({ error: "Nothing left to request for this agent." }, { status: 409 });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || req.nextUrl.origin).replace(/\/$/, "");
  const lines = [
    `Missing tool for the agent "${agent.name}" (${agent.emoji}):`,
    ...pending.map((m) => `- ${m.need}${m.reason ? `: ${m.reason}` : ""}`),
    "",
    `What the agent should do: ${agent.request}`,
    `${appUrl}/agents/${agent.id}`,
  ];
  let content = lines.join("\n");
  if (content.length > IDEA_MAX_LENGTH) content = `${content.slice(0, IDEA_MAX_LENGTH - 1)}…`;

  const { error } = await db.from("ideas").insert({ user_id: user.id, content });
  if (error) return NextResponse.json({ error: "Could not send the request" }, { status: 500 });

  // DM best-effort : la demande est enregistrée dans /admin/ideas quoi qu'il arrive.
  const notified = await notifyNewIdea({ content, authorName: user.name, authorEmail: user.email });
  if (!notified.sent && notified.reason !== "slack_disabled") {
    console.warn(`[agents/request-tool] Slack DM not sent: ${notified.reason}`);
  }

  const requestedAt = new Date().toISOString();
  const notes = {
    ...(agent.design_notes ?? { assumptions: [], source_reasons: [] }),
    missing_tools: all.map((m) => (m.requested_at ? m : { ...m, requested_at: requestedAt })),
  };
  const { data, error: updErr } = await db.from("agents").update({ design_notes: notes }).eq("id", id).select("*").single<AgentRow>();
  if (updErr || !data) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 500 });
  return NextResponse.json({ agent: data, notified: notified.sent });
}
