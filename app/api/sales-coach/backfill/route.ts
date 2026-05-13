import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getClaapRecording,
  pickTranscriptUrl,
  extractExternalParticipants,
  extractTitleSearchHint,
} from "@/lib/claap";
import { resolveDealFromParticipants } from "@/lib/hubspot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  recordingId?: string;
  hubspotDealId?: string;
  force?: boolean;
};

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "CLAAP_API_TOKEN not configured" }, { status: 500 });
  }

  const { recordingId, hubspotDealId, force } = (await req.json().catch(() => ({}))) as Body;
  if (!recordingId) return NextResponse.json({ error: "recordingId missing" }, { status: 400 });

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  // Fetch fresh recording (for transcript URL + metadata)
  const rec = await getClaapRecording(recordingId).catch((e) => {
    throw new Error(`Claap fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!rec) return NextResponse.json({ error: "Recording not found on Claap" }, { status: 404 });

  // Ownership check: user can only backfill their own recordings unless admin
  const recorderEmail = (rec.recorder?.email ?? "").toLowerCase();
  if (!isAdmin && recorderEmail !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "Tu ne peux analyser que tes propres meetings" }, { status: 403 });
  }

  const transcriptUrl = pickTranscriptUrl(rec);
  if (!transcriptUrl) return NextResponse.json({ error: "Pas de transcript disponible sur Claap" }, { status: 400 });

  // The backfill endpoint is user-initiated (someone clicked "Analyser" on a
  // specific recording), so we accept any meeting with a transcript — even
  // those Claap classified as internal. The user is opting in explicitly.
  // The webhook keeps a stricter guard since it runs automatically.
  const titleHint = extractTitleSearchHint(rec.title, recorderEmail);

  // Check if already analyzed (idempotency)
  const { data: existing } = await db
    .from("sales_coach_analyses")
    .select("id, status")
    .eq("claap_recording_id", rec.id)
    .maybeSingle();

  if (existing && !force && (existing.status === "done" || existing.status === "analyzing")) {
    return NextResponse.json({ ok: true, id: existing.id, already: existing.status });
  }

  // Resolve user_id from recorder email
  const { data: recorderUser } = await db
    .from("users")
    .select("id")
    .eq("email", recorderEmail)
    .maybeSingle();

  // If user didn't provide a deal ID, try to auto-resolve via participants
  // (with title-based company-name fallback as last resort).
  let resolvedDealId: string | null = hubspotDealId?.trim() || null;
  if (!resolvedDealId && recorderEmail) {
    const participantEmails = (rec.meeting?.participants ?? [])
      .map((p) => p.email)
      .filter((e): e is string => !!e);
    resolvedDealId = await resolveDealFromParticipants(
      participantEmails,
      recorderEmail,
      titleHint,
    ).catch((e) => {
      console.warn("[backfill] deal auto-resolve failed:", e);
      return null;
    });
    if (resolvedDealId) {
      console.log(`[backfill] auto-resolved deal ${resolvedDealId} for recording ${rec.id}`);
    }
  }

  const externalParticipants = recorderEmail
    ? extractExternalParticipants(rec.meeting?.participants, recorderEmail)
    : [];

  const baseRow = {
    claap_recording_id: rec.id,
    claap_event_id: null,
    recorder_email: recorderEmail || "unknown",
    hubspot_deal_id: resolvedDealId,
    meeting_title: rec.title ?? null,
    meeting_started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
    // Honest classification: store what Claap actually reported. The UI can
    // surface an "Interne" tag if relevant — analysis still happened because
    // the user explicitly requested it.
    meeting_type: rec.meeting?.type ?? null,
    participants: externalParticipants.length > 0 ? externalParticipants : null,
    user_id: recorderUser?.id ?? null,
    status: "pending" as const,
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: upsertErr } = await db
    .from("sales_coach_analyses")
    .upsert(baseRow, { onConflict: "claap_recording_id" })
    .select("id")
    .single();

  if (upsertErr || !inserted) {
    return NextResponse.json({ error: upsertErr?.message ?? "Insert failed" }, { status: 500 });
  }

  // Trigger the analyzer (fire-and-forget, same pattern as webhook)
  const siteUrl = req.nextUrl.origin;
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET not configured — can't trigger analyzer" }, { status: 500 });
  }

  // Await with short timeout: analyzer flips status to "analyzing" immediately,
  // then keeps running on its own 300s budget. Without await, serverless can
  // kill the outbound request before it leaves.
  try {
    const triggerRes = await fetch(`${siteUrl}/api/sales-coach/analyze/${inserted.id}`, {
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
      console.error(`[backfill] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[backfill] trigger fetch failed:", msg);
    }
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
