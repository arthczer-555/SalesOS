import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAgent } from "@/lib/agents/access";
import { triggerAgentDesign } from "@/lib/agents/trigger";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/design
// Body : { feedback?: string }
//  - avec feedback : "Refine with AI", le designer applique la demande de
//    modification à la spec actuelle ;
//  - sans feedback : redesign complet depuis la demande d'origine (relance
//    après une erreur).
// Dans les deux cas un aperçu est recalculé ensuite.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Only the agent's owner can edit it." }, { status: 403 });
  if (access.agent.design_status === "designing") {
    return NextResponse.json({ error: "A design is already in progress." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { feedback?: unknown };
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 2000) : "";

  await db
    .from("agents")
    .update({ design_status: "designing", design_error: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  try {
    await triggerAgentDesign(
      req.nextUrl.origin,
      id,
      feedback ? { feedback } : { keepName: access.agent.name !== "New agent" },
    );
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Design failed to start";
    await db.from("agents").update({ design_status: "error", design_error: message }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
