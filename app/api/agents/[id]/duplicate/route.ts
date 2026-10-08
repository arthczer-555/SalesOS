import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAgent } from "@/lib/agents/access";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/duplicate : copie l'agent en brouillon pour l'user
// courant (le sien ou celui d'un collègue, depuis l'onglet Team). La copie
// livre en DM à son nouvel owner : on ne reprend pas le canal d'un autre.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const a = access.agent;
  const own = a.owner_id === user.id;

  const { data, error } = await db
    .from("agents")
    .insert({
      owner_id: user.id,
      name: `${a.name}${own ? " (copy)" : ""}`.slice(0, 60),
      emoji: a.emoji,
      color: a.color,
      tagline: a.tagline,
      request: a.request,
      must_include: a.must_include,
      instructions: a.instructions,
      template: a.template,
      sources: a.sources,
      language: a.language,
      schedule: a.schedule,
      destination: own ? a.destination : { type: "dm" },
      skip_when_empty: a.skip_when_empty,
      design_notes: a.design_notes,
      status: "draft",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Duplicate failed" }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
