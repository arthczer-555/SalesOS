import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getClaapRecording,
  pickTranscriptUrl,
  extractExternalParticipants,
  extractTitleSearchHint,
} from "@/lib/claap";
import { fetchDealContext, resolveDealFromParticipants } from "@/lib/hubspot";
import { sendManualDealAlert } from "@/lib/sales-coach/admin-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select(
      "user_id, claap_recording_id, recorder_email, meeting_title, meeting_started_at, participants, hubspot_deal_id",
    )
    .eq("id", id)
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const transcriptUrl = pickTranscriptUrl(rec);
  if (!transcriptUrl) return NextResponse.json({ error: "Pas de transcript disponible sur Claap" }, { status: 400 });

  // Backfill participants if missing — Claap is already in hand
  const needsParticipants =
    !row.participants || (Array.isArray(row.participants) && row.participants.length === 0);
  const participants = needsParticipants && row.recorder_email
    ? extractExternalParticipants(rec.meeting?.participants, row.recorder_email)
    : [];

  // Si la ligne n'a pas de deal HubSpot rattaché, on retente le résolveur auto
  // (4 étapes : email → domaine → titre → LLM) AVANT de relancer l'analyse.
  // Si rien ne matche : on bascule en `awaiting_manual_deal` pour que l'UI
  // affiche le bloc Oui/Non + autocomplete au lieu de relancer une analyse
  // sans contexte HubSpot.
  let resolvedDealId: string | null = row.hubspot_deal_id ?? null;
  let resolvedSnapshotUpdate: Record<string, unknown> = {};
  if (!resolvedDealId && row.recorder_email) {
    const participantEmails = (rec.meeting?.participants ?? [])
      .map((p) => p.email)
      .filter((e): e is string => !!e);
    const titleHint = extractTitleSearchHint(row.meeting_title, row.recorder_email);
    const auto = await resolveDealFromParticipants(
      participantEmails,
      row.recorder_email,
      titleHint,
      row.meeting_title,
    ).catch((e) => {
      console.warn(`[reanalyze/${id}] auto-resolver failed:`, e instanceof Error ? e.message : e);
      return null;
    });
    if (auto) {
      resolvedDealId = auto;
      const snapshot = await fetchDealContext(auto).catch(() => null);
      resolvedSnapshotUpdate = { hubspot_deal_id: auto, deal_snapshot: snapshot };
      console.log(`[reanalyze/${id}] auto-resolved deal ${auto}`);
    }
  }

  // Aucun deal trouvé → bascule en awaiting_manual_deal, on ne lance PAS
  // l'analyse. L'UI affichera le bloc Oui/Non pour résolution manuelle.
  if (!resolvedDealId) {
    const update: Record<string, unknown> = {
      status: "awaiting_manual_deal",
      error_message: null,
      updated_at: new Date().toISOString(),
    };
    if (participants.length > 0) update.participants = participants;
    await db.from("sales_coach_analyses").update(update).eq("id", id);
    console.log(`[reanalyze/${id}] no deal resolvable — switched to awaiting_manual_deal`);

    // Symétrie avec le webhook Claap : on notifie Slack pour que le recorder
    // (ou Arthur en mode test) sache qu'une résolution manuelle est en attente.
    const alertParticipants = participants.length > 0
      ? participants.map((p) => p.email)
      : Array.isArray(row.participants)
        ? (row.participants as { email?: string }[])
            .map((p) => p.email)
            .filter((e): e is string => !!e)
        : [];
    const alertRes = await sendManualDealAlert({
      analysisId: id,
      claapRecordingId: row.claap_recording_id ?? null,
      meetingTitle: row.meeting_title ?? null,
      meetingStartedAt: row.meeting_started_at ?? rec.meeting?.startingAt ?? null,
      recorderEmail: row.recorder_email ?? null,
      participantEmails: alertParticipants,
    }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!alertRes.ok) {
      console.warn(`[reanalyze/${id}] manual-deal Slack alert failed:`, alertRes.error);
    } else if ("destination" in alertRes && alertRes.destination) {
      console.log(`[reanalyze/${id}] manual-deal Slack alert sent to ${alertRes.destination}`);
    }

    return NextResponse.json({ ok: true, awaiting_manual_deal: true });
  }

  const resetPayload: Record<string, unknown> = {
    status: "pending",
    error_message: null,
    updated_at: new Date().toISOString(),
    // Reset des timestamps Slack pour que les 2 DM (coaching + recap) soient
    // ré-envoyés. sendMeetingRecapSlack court-circuite si
    // meeting_recap_slack_sent_at est déjà set, donc sans ce reset le user
    // ne reçoit pas le nouveau recap. Idem coaching (slack_sent_at). On clear
    // aussi les artefacts Slack du recap précédent (ts, channel, permalink,
    // text) qui pointent vers un message obsolète.
    slack_sent_at: null,
    meeting_recap_slack_sent_at: null,
    meeting_recap_slack_text: null,
    meeting_recap_slack_ts: null,
    meeting_recap_slack_channel: null,
    meeting_recap_slack_permalink: null,
    ...resolvedSnapshotUpdate,
  };
  if (participants.length > 0) resetPayload.participants = participants;

  // Reset status to pending so the analyzer processes it again
  await db.from("sales_coach_analyses").update(resetPayload).eq("id", id);

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET not configured" }, { status: 500 });
  }

  const siteUrl = req.nextUrl.origin;
  // Await with short timeout: analyzer flips status to "analyzing" immediately,
  // then keeps running on its own 300s budget. Without await, serverless can
  // kill the outbound request before it leaves.
  try {
    const triggerRes = await fetch(`${siteUrl}/api/sales-coach/analyze/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify({ transcriptUrl }),
      signal: AbortSignal.timeout(8000),
    });
    if (!triggerRes.ok) {
      const text = await triggerRes.text().catch(() => "");
      console.error(`[reanalyze] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[reanalyze] trigger fetch failed:", msg);
    }
  }

  return NextResponse.json({ ok: true });
}
