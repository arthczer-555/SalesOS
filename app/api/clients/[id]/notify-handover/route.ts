import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyHandoverAmCs } from "@/lib/clients/notify-handover";

export const dynamic = "force-dynamic";

// POST /api/clients/[id]/notify-handover
// Body: { amEmail, amName?, csEmail, csName? }
//
// Assigne l'AM/CS au client et leur envoie un DM Slack ("contexte closed-won
// prêt"). Pas de garde-fou bloquant sur les champs : l'AE peut notifier même
// avec des champs vides (les lignes vides sont juste surlignées sur la fiche).
//
// L'AM/CS choisis sont sauvegardés AVANT l'envoi Slack : un DM qui échoue (ou
// Slack non configuré) ne doit pas faire perdre le choix. am_cs_notified_at
// n'est posé (par notifyHandoverAmCs) que si le DM est parti ; sinon la route
// renvoie une erreur explicite et le bandeau handover reste affiché.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  let body: { amEmail?: string; amName?: string; csEmail?: string; csName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch (e) {
    return NextResponse.json({ error: `bad JSON: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const amEmail = body.amEmail?.trim();
  const csEmail = body.csEmail?.trim();
  if (!amEmail || !csEmail) {
    return NextResponse.json({ error: "amEmail and csEmail are required" }, { status: 400 });
  }

  const { error: saveErr } = await db
    .from("clients")
    .update({
      am_email: amEmail,
      am_name: body.amName?.trim() || null,
      cs_email: csEmail,
      cs_name: body.csName?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  const result = await notifyHandoverAmCs(id, {
    amEmail,
    amName: body.amName?.trim() || null,
    csEmail,
    csName: body.csName?.trim() || null,
  });

  if (!result.ok || !result.sent) {
    const reason = result.reason === "slack_disabled" ? "Slack is not configured" : result.reason ?? "notify_failed";
    return NextResponse.json(
      { error: `AM and CS saved, but the Slack message was not sent (${reason}). Try again.` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sent: result.sent ?? false, mode: result.mode });
}
