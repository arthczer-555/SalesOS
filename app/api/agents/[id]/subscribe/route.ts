import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { loadAgent } from "@/lib/agents/access";
import { setSubscription } from "@/lib/agents/subscriptions";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/subscribe
// Body : { active: boolean }
// S'abonner à l'agent d'un collègue (onglet Team) : à chaque échéance de son
// planning, l'agent tourne aussi pour l'abonné, avec SON identité, et livre
// dans SON DM. L'owner n'a pas à s'abonner à son propre agent.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (access.agent.owner_id === user.id) {
    return NextResponse.json({ error: "This is your agent: it already runs for you." }, { status: 400 });
  }
  // Un admin ou un destinataire voit un agent personnel, mais ne peut pas
  // s'abonner à un agent que son owner n'a pas partagé.
  const body = (await req.json().catch(() => ({}))) as { active?: unknown };
  const active = body.active !== false;
  if (active && access.agent.shared !== true) {
    return NextResponse.json({ error: "This agent is personal: its owner hasn't shared it with the team." }, { status: 403 });
  }
  // Déjà dans l'audience : s'abonner en plus enverrait deux DMs.
  if (active && access.isRecipient) {
    return NextResponse.json({ error: "You already receive this agent: its creator sends it to you." }, { status: 400 });
  }

  const res = await setSubscription(id, user.id, active);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 503 });
  return NextResponse.json({ ok: true, subscribed: active });
}
