import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotDealUrl } from "@/lib/leads/finalize";
import { canEditAnalysis } from "@/lib/sales-coach/access";
import { processCardConfirmation } from "@/lib/sales-coach/card-flow";
import { latestPendingForAnalysis } from "@/lib/slack/confirmations";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Bascule HubSpot du 30/11 : confirmation, depuis la fiche Sales Coach, que le
// meeting appartient bien à sa carte (même effet qu'un ✅ sur le DM Slack) :
// la carte passe en Scoping (SQL) si elle est encore en R1 scheduled, et le
// score est écrit dans HubSpot. "no" : rien n'est écrit.
// GET : y a-t-il une demande en attente pour ce meeting ?

async function loadRow(id: string) {
  const { data } = await db
    .from("sales_coach_analyses")
    .select("id, user_id, recorder_email, internal_emails, hubspot_deal_id, status")
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; user_id: string | null; recorder_email: string | null; internal_emails: string[] | null; hubspot_deal_id: string | null; status: string } | null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const row = await loadRow(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pending = await latestPendingForAnalysis(id).catch(() => null);
  const { data } = await db
    .from("sales_coach_analyses")
    .select("deal_match_method, stage_move_result, deal_snapshot, meeting_title, meeting_started_at, participants")
    .eq("id", id)
    .maybeSingle();
  const tracking = data as {
    deal_match_method?: string | null;
    stage_move_result?: string | null;
    deal_snapshot?: { id?: string; name?: string } | null;
    meeting_title?: string | null;
    meeting_started_at?: string | null;
    participants?: { name?: string | null; email?: string | null }[] | null;
  } | null;
  // La carte visée est nommée dans le bandeau : nom figé dans la demande, sinon
  // celui du snapshot du deal (aucun appel HubSpot à l'affichage).
  const dealId = pending?.deal_id ?? row.hubspot_deal_id;
  const snapshot = tracking?.deal_snapshot ?? null;
  const proposedName = typeof pending?.proposed?.dealName === "string" ? pending.proposed.dealName : null;
  const dealName = proposedName ?? (snapshot?.id === dealId ? snapshot?.name ?? null : null);
  return NextResponse.json({
    pending: pending ? { kind: pending.kind, dealId: pending.deal_id, expiresAt: pending.expires_at } : null,
    deal: dealId ? { id: dealId, name: dealName, url: hubspotDealUrl(dealId) } : null,
    meeting: {
      title: tracking?.meeting_title ?? null,
      startedAt: tracking?.meeting_started_at ?? null,
      participants: (tracking?.participants ?? []).map((p) => p.name || p.email).filter((x): x is string => !!x).slice(0, 4),
    },
    matchMethod: tracking?.deal_match_method ?? null,
    stageMoveResult: tracking?.stage_move_result ?? null,
    canEdit: canEditAnalysis(user, row),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { answer?: string };
  if (body.answer !== "yes" && body.answer !== "no") return NextResponse.json({ error: "answer must be yes or no" }, { status: 400 });

  const row = await loadRow(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditAnalysis(user, row)) {
    return NextResponse.json({ error: "Only the meeting's participants, the deal owner or an admin can confirm." }, { status: 403 });
  }
  if (!row.hubspot_deal_id) return NextResponse.json({ error: "This meeting has no deal." }, { status: 400 });
  if (row.status !== "done") return NextResponse.json({ error: "Wait for the analysis to finish." }, { status: 409 });

  const res = await processCardConfirmation({ analysisId: id, answer: body.answer, appUser: { id: user.id, email: user.email ?? null } });
  return NextResponse.json({ ok: res.ok, message: slackToPlain(res.message) }, { status: res.ok ? 200 : 409 });
}

/** Le résultat est rédigé pour Slack (liens <url|nom>, :emoji:, *gras*) : texte simple pour l'app. */
function slackToPlain(text: string): string {
  return text
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/:[a-z][a-z0-9_+-]*:\s?/g, "")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .trim();
}
