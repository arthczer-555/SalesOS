import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClaapRecording, pickTranscriptUrl } from "@/lib/claap";
import { fetchDealContext } from "@/lib/hubspot";
import { canEditAnalysis } from "@/lib/sales-coach/access";
import { SLACK_DELIVERY_RESET, triggerSalesCoachAnalysis } from "@/lib/sales-coach/trigger-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Change (ou pose) le deal HubSpot d'une analyse Sales Coach, puis relance
 * l'analyse avec le contexte du nouveau deal. Bouton "Change deal" de la fiche,
 * et "Link a deal" quand l'analyse a tourné sans deal.
 *
 * Toujours suivi d'une nouvelle analyse : tout le debrief dépend du deal
 * (prospect ou client, historique HubSpot, analyses précédentes du deal, score
 * IA). Garder l'ancienne analyse sous un nouveau deal mélangerait deux comptes.
 *
 * - `user_id` repart du recorder : run-analysis le réattribue ensuite à
 *   l'owner du nouveau deal s'il a un compte. Sans ce reset, la ligne restait
 *   à l'owner de l'ancien deal quand le nouveau n'a pas de compte CoachelloHQ.
 * - Les champs Slack sont remis à zéro comme pour Re-analyze : le debrief et
 *   le recap repartent, corrigés (l'ancien recap portait le mauvais compte).
 * - Rien n'est modifié si le deal ou le transcript sont illisibles : mieux
 *   vaut garder l'ancien rattachement qu'une ligne sans snapshot ni analyse.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { dealId?: string };
  const dealId = body.dealId?.trim() ?? "";
  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Invalid HubSpot deal id" }, { status: 400 });
  }

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("id, user_id, recorder_email, internal_emails, claap_recording_id, hubspot_deal_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditAnalysis(user, row)) {
    return NextResponse.json(
      { error: "Only the meeting's participants, the deal owner or an admin can change the deal." },
      { status: 403 },
    );
  }
  if (row.status === "pending" || row.status === "analyzing") {
    return NextResponse.json(
      { error: "An analysis is already running for this meeting. Try again once it is done." },
      { status: 409 },
    );
  }
  if (row.hubspot_deal_id === dealId) {
    return NextResponse.json({ error: "This meeting is already linked to this deal." }, { status: 400 });
  }
  if (!row.claap_recording_id) {
    return NextResponse.json({ error: "No Claap recording linked" }, { status: 400 });
  }
  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "CLAAP_API_TOKEN not configured" }, { status: 500 });
  }
  if (!process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "INTERNAL_SECRET not configured" }, { status: 500 });
  }

  const [snapshot, rec] = await Promise.all([
    fetchDealContext(dealId).catch(() => null),
    getClaapRecording(row.claap_recording_id).catch(() => null),
  ]);
  if (!snapshot) {
    return NextResponse.json(
      { error: "Could not load this deal from HubSpot. Nothing was changed." },
      { status: 502 },
    );
  }
  const transcriptUrl = rec ? pickTranscriptUrl(rec) : null;
  if (!transcriptUrl) {
    return NextResponse.json(
      { error: "No transcript available on Claap. Nothing was changed." },
      { status: 400 },
    );
  }

  const { data: recorderUser } = row.recorder_email
    ? await db.from("users").select("id").eq("email", row.recorder_email).maybeSingle()
    : { data: null };

  const { error: updateErr } = await db
    .from("sales_coach_analyses")
    .update({
      hubspot_deal_id: dealId,
      deal_snapshot: snapshot,
      // Un meeting rattaché à un deal n'est plus "interne" (cf. resolve-deal).
      meeting_type: "external",
      ...(recorderUser?.id ? { user_id: recorderUser.id } : {}),
      status: "pending",
      error_message: null,
      updated_at: new Date().toISOString(),
      ...SLACK_DELIVERY_RESET,
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  console.log(
    `[change-deal/${id}] deal ${row.hubspot_deal_id ?? "none"} → ${dealId} (${snapshot.name ?? "?"}) by ${user.email}`,
  );

  await triggerSalesCoachAnalysis({ origin: req.nextUrl.origin, id, transcriptUrl, logTag: "change-deal" });

  return NextResponse.json({ ok: true, dealId, name: snapshot.name ?? null });
}
