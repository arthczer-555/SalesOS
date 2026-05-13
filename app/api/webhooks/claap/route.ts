import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDealFromParticipants } from "@/lib/hubspot";
import { extractExternalParticipants, extractTitleSearchHint } from "@/lib/claap";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ClaapParticipant = {
  id?: string;
  name?: string;
  email?: string;
  attended?: boolean;
};

type ClaapRecording = {
  id: string;
  createdAt?: string;
  title?: string;
  meeting?: {
    type?: "external" | "internal";
    startingAt?: string;
    endingAt?: string;
    participants?: ClaapParticipant[];
  };
  deal?: { id?: string; name?: string };
  crmInfo?: { crm?: string };
  transcripts?: { url?: string; textUrl?: string; langIso2?: string; isActive?: boolean }[];
  recorder?: ClaapParticipant;
};

type ClaapPayload = {
  eventId?: string;
  event?: {
    type?: "recording_added" | "recording_updated";
    recording?: ClaapRecording;
  };
};

export async function POST(req: NextRequest) {
  try {
    // ── Signature check (shared secret) ─────────────────────────────────
    const secret = process.env.CLAAP_WEBHOOK_SECRET;
    if (secret) {
      const received = req.headers.get("x-claap-webhook-secret");
      if (received !== secret) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = (await req.json()) as ClaapPayload;
    const evt = payload.event;
    const rec = evt?.recording;

    if (!evt?.type || !rec?.id) {
      return NextResponse.json({ ok: true, ignored: "missing event/recording" });
    }

    // Only process new recordings. Updates would re-trigger analysis — skip them.
    if (evt.type !== "recording_added") {
      return NextResponse.json({ ok: true, ignored: `event type ${evt.type}` });
    }

    // Scope filter: external meeting + linked to a HubSpot deal
    let meetingType = rec.meeting?.type ?? "";
    let dealId = rec.deal?.id ?? null;
    const recorderEmail = rec.recorder?.email ?? "";
    const transcriptUrl = rec.transcripts?.find((t) => t.isActive)?.textUrl ?? rec.transcripts?.[0]?.textUrl ?? null;

    // Title hint — used both to seed the HubSpot deal/company name search and
    // to decide whether to override Claap's "internal" classification (below).
    const titleHint = extractTitleSearchHint(rec.title, recorderEmail);

    // Fallback: if Claap didn't link a deal, try to resolve via participant
    // emails (stage 1+2 inside the resolver) then via the title hint (stage 3).
    // We run this BEFORE the internal-drop decision so a HubSpot match can
    // serve as evidence to override Claap's mis-classification.
    if (!dealId && recorderEmail) {
      const participantEmails = (rec.meeting?.participants ?? [])
        .map((p) => p.email)
        .filter((e): e is string => !!e);
      dealId = await resolveDealFromParticipants(
        participantEmails,
        recorderEmail,
        titleHint,
      ).catch((e) => {
        console.warn("[claap-webhook] deal auto-resolve failed:", e);
        return null;
      });
      if (dealId) {
        console.log(`[claap-webhook] auto-resolved deal ${dealId} for recording ${rec.id}`);
      }
    }

    // Internal override safeguard: Claap mis-classifies some external meetings
    // as "internal" when no external attendee was captured in the calendar
    // invite. We only promote internal→external when ALL of these hold:
    //   - the title yields a non-trivial search hint (titleHint)
    //   - the auto-resolve actually found a matching HubSpot deal
    // No HubSpot footprint → trust Claap and drop. The user can still
    // manually analyse the recording from the "Analyser un meeting passé"
    // modal if they disagree with this verdict.
    if (meetingType === "internal" && dealId && titleHint) {
      console.log(
        `[claap-webhook] overriding internal→external for recording ${rec.id} — deal ${dealId} matched via title hint "${titleHint}"`,
      );
      meetingType = "external";
    }

    // Internal meetings (after title-based override) are dropped entirely — no
    // row created, no UI noise.
    if (meetingType === "internal") {
      return NextResponse.json({ ok: true, ignored: "meeting_type_internal" });
    }

    // Only skip when truly unanalysable. A missing deal is OK — analysis still
    // produces value via the 6 coaching axes + MEDDIC, and the deal can be
    // attached later from the UI.
    const shouldSkip =
      meetingType !== "external" ||
      !recorderEmail ||
      !transcriptUrl;

    const externalParticipants = recorderEmail
      ? extractExternalParticipants(rec.meeting?.participants, recorderEmail)
      : [];

    const baseRow = {
      claap_recording_id: rec.id,
      claap_event_id: payload.eventId ?? null,
      recorder_email: recorderEmail || "unknown",
      hubspot_deal_id: dealId,
      meeting_title: rec.title ?? null,
      meeting_started_at: rec.meeting?.startingAt ?? null,
      meeting_type: meetingType || null,
      participants: externalParticipants.length > 0 ? externalParticipants : null,
      updated_at: new Date().toISOString(),
    };

    if (shouldSkip) {
      const reason = meetingType !== "external"
        ? `meeting_type_${meetingType}`
        : !recorderEmail
          ? "no_recorder_email"
          : "no_transcript";
      await db.from("sales_coach_analyses").upsert(
        { ...baseRow, status: "skipped", error_message: reason },
        { onConflict: "claap_recording_id" },
      );
      return NextResponse.json({ ok: true, skipped: reason });
    }

    // Resolve user_id from recorder email (nullable — user might not exist yet)
    const { data: userRow } = await db
      .from("users")
      .select("id")
      .eq("email", recorderEmail)
      .maybeSingle();

    // Upsert — keyed on claap_recording_id for idempotency against Claap retries
    const { data: inserted, error: insertErr } = await db
      .from("sales_coach_analyses")
      .upsert(
        {
          ...baseRow,
          user_id: userRow?.id ?? null,
          status: "pending",
          error_message: null,
        },
        { onConflict: "claap_recording_id" },
      )
      .select("id, status")
      .single();

    if (insertErr || !inserted) {
      console.error("[claap-webhook] upsert error:", insertErr);
      return NextResponse.json({ error: "Storage error" }, { status: 500 });
    }

    // Fire-and-forget trigger analysis. Pass transcriptUrl so the analyzer doesn't
    // have to re-fetch recording metadata from Claap (textUrl is valid 24h).
    // Use the actual request origin so dev and prod both route back to themselves,
    // instead of accidentally hitting the prod URL from local dev.
    const siteUrl = req.nextUrl.origin;
    const internalSecret = process.env.INTERNAL_SECRET;

    if (siteUrl && internalSecret) {
      // Await the trigger fetch so Netlify doesn't kill the function before the
      // request goes out. The analyzer flips status to "analyzing" and returns
      // ~immediately, so we wait at most a couple of seconds — Claude itself
      // runs on its own request budget after that.
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
          console.error(`[claap-webhook] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
        }
      } catch (e) {
        // AbortError after 8s is expected when Claude takes longer than that to
        // start streaming; the analyzer keeps running server-side.
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted") && !msg.includes("timeout")) {
          console.error("[claap-webhook] trigger fetch failed:", msg);
        }
      }
    } else {
      console.warn("[claap-webhook] missing SITE_URL or INTERNAL_SECRET — analysis will not start");
    }

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (e) {
    console.error("[claap-webhook] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
