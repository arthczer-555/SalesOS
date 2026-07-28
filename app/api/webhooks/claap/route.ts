import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  resolveDealFromParticipants,
  resolveCompanyFromParticipants,
  type CompanyMatchSnapshot,
} from "@/lib/hubspot";
import { extractExternalParticipants, extractInternalEmails, extractTitleSearchHint } from "@/lib/claap";
import { sendManualDealAlert } from "@/lib/sales-coach/admin-alert";

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

    // HubSpot deal IDs natifs sont des entiers. Tout ID alphanumérique (ex:
    // "8ncGo4qjgFJW32zx") vient d'un objet interne Claap et ne résoudra pas
    // côté HubSpot — on l'ignore et on tombe dans le fallback résolveur.
    const rawDealIdFromClaap = rec.deal?.id ?? null;
    let dealId: string | null =
      rawDealIdFromClaap && /^\d+$/.test(rawDealIdFromClaap) ? rawDealIdFromClaap : null;
    if (rawDealIdFromClaap && !dealId) {
      console.warn(
        `[claap-webhook] discarding non-numeric Claap deal id "${rawDealIdFromClaap}" for recording ${rec.id}`,
      );
    }

    const recorderEmail = rec.recorder?.email ?? "";
    const transcriptUrl = rec.transcripts?.find((t) => t.isActive)?.textUrl ?? rec.transcripts?.[0]?.textUrl ?? null;

    // Title hint — used both to seed the HubSpot deal/company name search and
    // to decide whether to override Claap's "internal" classification (below).
    const titleHint = extractTitleSearchHint(rec.title, recorderEmail);

    const participantEmails = (rec.meeting?.participants ?? [])
      .map((p) => p.email)
      .filter((e): e is string => !!e);

    // Fallback: if Claap didn't link a (valid) deal, try to resolve via
    // participant emails (stage 1+2 inside the resolver), the title hint
    // (stage 3), and finally LLM semantic matching against the active deal
    // pool (stage 4). Runs BEFORE the internal-drop decision so a HubSpot
    // match can serve as evidence to override Claap's mis-classification.
    //
    // In parallel, look up the HubSpot company by domain/name — kept on the
    // row for UI fallback when the deal can't be loaded. Does NOT participate
    // in prospect/client classification (that's deal-stage only).
    let companyMatch: CompanyMatchSnapshot | null = null;
    if (recorderEmail) {
      const [resolvedDeal, resolvedCompany] = await Promise.all([
        dealId
          ? Promise.resolve(dealId)
          : resolveDealFromParticipants(
              participantEmails,
              recorderEmail,
              titleHint,
              rec.title ?? null,
            ).catch((e) => {
              console.warn("[claap-webhook] deal auto-resolve failed:", e);
              return null;
            }),
        resolveCompanyFromParticipants(
          participantEmails,
          recorderEmail,
          titleHint,
        ).catch((e) => {
          console.warn("[claap-webhook] company auto-resolve failed:", e);
          return null;
        }),
      ]);
      if (resolvedDeal && resolvedDeal !== dealId) {
        console.log(`[claap-webhook] auto-resolved deal ${resolvedDeal} for recording ${rec.id}`);
      }
      dealId = resolvedDeal;
      companyMatch = resolvedCompany;
      if (companyMatch) {
        console.log(
          `[claap-webhook] matched company ${companyMatch.id} (${companyMatch.name ?? "?"}, lifecycle=${companyMatch.lifecyclestage ?? "?"}) for recording ${rec.id}`,
        );
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
    const internalEmails = recorderEmail
      ? extractInternalEmails(rec.meeting?.participants, recorderEmail)
      : [];

    const baseRow = {
      claap_recording_id: rec.id,
      claap_event_id: payload.eventId ?? null,
      recorder_email: recorderEmail || "unknown",
      hubspot_deal_id: dealId,
      hubspot_company_id: companyMatch?.id ?? null,
      company_snapshot: companyMatch,
      meeting_title: rec.title ?? null,
      meeting_started_at: rec.meeting?.startingAt ?? null,
      meeting_type: meetingType || null,
      participants: externalParticipants.length > 0 ? externalParticipants : null,
      internal_emails: internalEmails.length > 0 ? internalEmails : null,
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

    // Court-circuit : meeting externe sans deal HubSpot résolu (4 étapes du
    // resolver KO). On crée la ligne en `awaiting_manual_deal` sans lancer
    // l'analyse, et on notifie Slack pour que l'utilisateur associe le deal
    // manuellement depuis l'UI. Le bouton "Oui" de la fiche déclenchera ensuite
    // l'analyse exactement comme ce webhook le ferait.
    if (!dealId) {
      // Dédup de l'alerte Slack : Claap rejoue parfois `recording_added` pour
      // un même `recording.id`. L'upsert ci-dessous est idempotent côté DB,
      // mais sans ce check, l'alerte partirait à chaque retry. On regarde
      // l'état avant upsert, et on n'envoie l'alerte que sur la PREMIÈRE
      // transition vers awaiting_manual_deal.
      const { data: existingRow } = await db
        .from("sales_coach_analyses")
        .select("status")
        .eq("claap_recording_id", rec.id)
        .maybeSingle();
      const alreadyAwaiting = existingRow?.status === "awaiting_manual_deal";

      const { data: awaitingRow, error: awaitingErr } = await db
        .from("sales_coach_analyses")
        .upsert(
          {
            ...baseRow,
            user_id: userRow?.id ?? null,
            status: "awaiting_manual_deal",
            error_message: null,
          },
          { onConflict: "claap_recording_id" },
        )
        .select("id")
        .single();

      if (awaitingErr || !awaitingRow) {
        console.error("[claap-webhook] awaiting upsert error:", awaitingErr);
        return NextResponse.json({ error: "Storage error" }, { status: 500 });
      }

      if (alreadyAwaiting) {
        console.log(
          `[claap-webhook] ${awaitingRow.id} already awaiting_manual_deal — skipping duplicate Slack alert`,
        );
        return NextResponse.json({ ok: true, id: awaitingRow.id, awaiting: true, alertSkipped: true });
      }

      const alertRes = await sendManualDealAlert({
        analysisId: awaitingRow.id,
        claapRecordingId: rec.id,
        meetingTitle: rec.title ?? null,
        meetingStartedAt: rec.meeting?.startingAt ?? null,
        recorderEmail,
        participantEmails: externalParticipants.map((p) => p.email),
      }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (!alertRes.ok) {
        console.warn(`[claap-webhook] manual-deal Slack alert failed for ${awaitingRow.id}:`, alertRes.error);
      } else if ("destination" in alertRes && alertRes.destination) {
        console.log(`[claap-webhook] manual-deal Slack alert sent to ${alertRes.destination} for ${awaitingRow.id}`);
      }

      return NextResponse.json({ ok: true, id: awaitingRow.id, awaiting: true });
    }

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

    // Trigger analysis. On Netlify we call the Background Function directly to
    // skip the intermediate Next.js sync route — fewer hops = fewer chances of
    // a timeout/abort leaving the row stuck in `pending`. In dev we fall back
    // to the regular route which runs inline. Either way: pass transcriptUrl
    // so the analyzer doesn't have to re-fetch from Claap (textUrl is valid 24h).
    const siteUrl = req.nextUrl.origin;
    const internalSecret = process.env.INTERNAL_SECRET;
    const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

    if (!internalSecret) {
      console.warn("[claap-webhook] missing INTERNAL_SECRET — analysis will not start");
    } else {
      const triggerUrl = isNetlifyEnv
        ? `${siteUrl}/.netlify/functions/sales-coach-analyze-background`
        : `${siteUrl}/api/sales-coach/analyze/${inserted.id}`;
      const body = isNetlifyEnv
        ? JSON.stringify({ id: inserted.id, transcriptUrl })
        : JSON.stringify({ transcriptUrl });
      try {
        const triggerRes = await fetch(triggerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": internalSecret,
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        // Background functions return 202 once queued; the regular route returns 200.
        if (!triggerRes.ok && triggerRes.status !== 202) {
          const text = await triggerRes.text().catch(() => "");
          console.error(`[claap-webhook] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
        }
      } catch (e) {
        // AbortError after 8s is expected for the inline-dev path when Claude
        // takes longer to start streaming; bg trigger should return 202 in <1s.
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("aborted") && !msg.includes("timeout")) {
          console.error("[claap-webhook] trigger fetch failed:", msg);
        }
      }
    }

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (e) {
    console.error("[claap-webhook] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
