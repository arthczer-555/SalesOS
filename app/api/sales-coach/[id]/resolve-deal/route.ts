import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClaapRecording, extractExternalParticipants, extractTitleSearchHint } from "@/lib/claap";
import { fetchDealContext, resolveDealFromParticipants } from "@/lib/hubspot";
import { sendSalesCoachSlack } from "@/lib/sales-coach/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Try to auto-resolve the HubSpot deal for an existing analysis via participant
// emails. Updates hubspot_deal_id + deal_snapshot if found. Does NOT re-run Claude.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, claap_recording_id, recorder_email, hubspot_deal_id, participants, status, slack_sent_at")
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.hubspot_deal_id) {
    return NextResponse.json({ ok: true, already: row.hubspot_deal_id });
  }
  if (!row.claap_recording_id) {
    return NextResponse.json({ error: "No Claap recording linked" }, { status: 400 });
  }
  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "CLAAP_API_TOKEN not configured" }, { status: 500 });
  }

  const rec = await getClaapRecording(row.claap_recording_id).catch((e) => {
    throw new Error(`Claap fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!rec) return NextResponse.json({ error: "Recording not found on Claap" }, { status: 404 });

  const participantEmails = (rec.meeting?.participants ?? [])
    .map((p) => p.email)
    .filter((e): e is string => !!e);
  const recorderEmail = rec.recorder?.email ?? row.recorder_email ?? "";

  if (!recorderEmail) {
    return NextResponse.json({ ok: false, reason: "no_recorder" });
  }

  // Title-based hint lets us match a deal even when Claap captured no
  // external participant emails (typical of meetings mis-classified as
  // internal). Without the hint, those recordings have no resolution path.
  const titleHint = extractTitleSearchHint(rec.title, recorderEmail);

  if (participantEmails.length === 0 && !titleHint) {
    return NextResponse.json({ ok: false, reason: "no_participants" });
  }

  const dealId = await resolveDealFromParticipants(
    participantEmails,
    recorderEmail,
    titleHint,
  );
  if (!dealId) {
    return NextResponse.json({ ok: false, reason: "no_match" });
  }

  const snapshot = await fetchDealContext(dealId).catch(() => null);

  // Backfill participants if missing (existing records predate the column)
  const participants =
    !row.participants || (Array.isArray(row.participants) && row.participants.length === 0)
      ? extractExternalParticipants(rec.meeting?.participants, recorderEmail)
      : null;

  const updatePayload: Record<string, unknown> = {
    hubspot_deal_id: dealId,
    deal_snapshot: snapshot,
    updated_at: new Date().toISOString(),
  };
  if (participants && participants.length > 0) {
    updatePayload.participants = participants;
  }

  const { error: updateErr } = await db
    .from("sales_coach_analyses")
    .update(updatePayload)
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Fire the Slack digest if this attribution unblocks it (analysis done,
  // not previously sent, and Slack globally enabled).
  const shouldSendSlack =
    row.status === "done" &&
    !row.slack_sent_at &&
    process.env.SALES_COACH_SLACK_ENABLED === "true";
  if (shouldSendSlack) {
    const slackRes = await sendSalesCoachSlack(db, id).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!slackRes.ok) {
      console.warn(`[sales-coach/${id}] Slack send after deal auto-resolve failed:`, slackRes.error);
    }
  }

  return NextResponse.json({ ok: true, dealId, name: snapshot?.name ?? null });
}
