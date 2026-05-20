import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getClaapRecording,
  extractExternalParticipants,
  extractTitleSearchHint,
  pickTranscriptUrl,
} from "@/lib/claap";
import {
  fetchDealContext,
  findDealsByExactName,
  resolveDealFromParticipants,
  type DealSearchResult,
} from "@/lib/hubspot";
import { sendSalesCoachSlack } from "@/lib/sales-coach/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ResolveBody = {
  // Sélectionné depuis l'autocomplete : on a déjà l'ID HubSpot, pas besoin de
  // chercher.
  dealId?: string;
  // Saisi à la main : on cherche un match exact (case-insensitive) côté
  // HubSpot. S'il y a ambiguïté, on renvoie les candidats au client.
  dealName?: string;
};

/**
 * Associe un deal HubSpot à une analyse Sales Coach.
 *
 * 3 modes :
 *  - `dealId` fourni → on récupère le snapshot et on attache directement.
 *  - `dealName` fourni → on cherche un match exact ; 0 → 404, 1 → on attache,
 *    plusieurs → on renvoie la liste pour disambiguation côté UI.
 *  - Aucun corps → fallback historique : auto-résolution via les participants
 *    Claap (4 étapes du résolveur).
 *
 * Si la ligne était en `awaiting_manual_deal` (créée par le webhook après un
 * resolver KO), on déclenche l'analyse en background une fois le deal attaché.
 * Si elle est déjà `done` et que Slack n'a pas été envoyé, on envoie le DM.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ResolveBody;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select(
      "id, user_id, claap_recording_id, recorder_email, hubspot_deal_id, participants, status, slack_sent_at",
    )
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.claap_recording_id) {
    return NextResponse.json({ error: "No Claap recording linked" }, { status: 400 });
  }

  // ── 1. Choisir un dealId selon le mode ─────────────────────────────────
  let dealId: string | null = body.dealId?.trim() || null;

  if (!dealId && body.dealName) {
    const matches = await findDealsByExactName(body.dealName).catch(() => [] as DealSearchResult[]);
    if (matches.length === 0) {
      return NextResponse.json({ ok: false, reason: "no_exact_match" }, { status: 404 });
    }
    if (matches.length > 1) {
      // Plusieurs deals portent ce nom exact → l'UI doit demander à l'utilisateur
      // de choisir. On retourne les candidats enrichis.
      return NextResponse.json({ ok: false, reason: "ambiguous", candidates: matches });
    }
    dealId = matches[0].id;
  }

  // Pas de dealId ni dealName → fallback auto-resolve historique (boutons
  // "Retrouver automatiquement" dans l'UI quand le deal a juste été perdu).
  if (!dealId) {
    if (row.hubspot_deal_id) {
      return NextResponse.json({ ok: true, already: row.hubspot_deal_id });
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
    const titleHint = extractTitleSearchHint(rec.title, recorderEmail);
    if (participantEmails.length === 0 && !titleHint) {
      return NextResponse.json({ ok: false, reason: "no_participants" });
    }
    const auto = await resolveDealFromParticipants(
      participantEmails,
      recorderEmail,
      titleHint,
      rec.title ?? null,
    );
    if (!auto) return NextResponse.json({ ok: false, reason: "no_match" });
    dealId = auto;
  }

  // ── 2. Snapshot + mise à jour de la ligne ──────────────────────────────
  const snapshot = await fetchDealContext(dealId).catch(() => null);

  // Backfill participants si manquants (anciennes lignes)
  let participantsToBackfill: { name: string | null; email: string; attended: boolean | null }[] | null = null;
  if (!row.participants || (Array.isArray(row.participants) && row.participants.length === 0)) {
    if (process.env.CLAAP_API_TOKEN) {
      const rec = await getClaapRecording(row.claap_recording_id).catch(() => null);
      if (rec && row.recorder_email) {
        const extracted = extractExternalParticipants(rec.meeting?.participants, row.recorder_email);
        if (extracted.length > 0) participantsToBackfill = extracted;
      }
    }
  }

  const wasAwaiting = row.status === "awaiting_manual_deal";

  const updatePayload: Record<string, unknown> = {
    hubspot_deal_id: dealId,
    deal_snapshot: snapshot,
    updated_at: new Date().toISOString(),
  };
  if (participantsToBackfill) updatePayload.participants = participantsToBackfill;
  // Passe en `pending` pour que l'analyse démarre. error_message null pour
  // effacer les éventuels messages "no_match" précédents.
  if (wasAwaiting) {
    updatePayload.status = "pending";
    updatePayload.error_message = null;
  }

  const { error: updateErr } = await db
    .from("sales_coach_analyses")
    .update(updatePayload)
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // ── 3. Déclenchement de l'analyse si la ligne attendait un deal ────────
  if (wasAwaiting) {
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret) {
      console.warn("[resolve-deal] INTERNAL_SECRET missing — analysis won't start");
    } else if (process.env.CLAAP_API_TOKEN) {
      // Re-fetch le recording pour récupérer le transcriptUrl (textUrl valide
      // 24h côté Claap, donc on ne l'a pas stocké dans la ligne).
      const rec = await getClaapRecording(row.claap_recording_id).catch(() => null);
      const transcriptUrl = rec ? pickTranscriptUrl(rec) : null;
      if (!transcriptUrl) {
        console.warn(`[resolve-deal] no transcript URL for ${id} — analysis cannot start`);
      } else {
        const siteUrl = req.nextUrl.origin;
        const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
        const triggerUrl = isNetlifyEnv
          ? `${siteUrl}/.netlify/functions/sales-coach-analyze-background`
          : `${siteUrl}/api/sales-coach/analyze/${id}`;
        const triggerBody = isNetlifyEnv
          ? JSON.stringify({ id, transcriptUrl })
          : JSON.stringify({ transcriptUrl });
        try {
          const triggerRes = await fetch(triggerUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": internalSecret,
            },
            body: triggerBody,
            signal: AbortSignal.timeout(8000),
          });
          if (!triggerRes.ok && triggerRes.status !== 202) {
            const text = await triggerRes.text().catch(() => "");
            console.error(`[resolve-deal] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("aborted") && !msg.includes("timeout")) {
            console.error("[resolve-deal] trigger fetch failed:", msg);
          }
        }
      }
    }
  }

  // ── 4. Si l'analyse était déjà `done` (auto-resolve a posteriori), on
  // envoie le DM Slack si pas déjà fait. Inchangé vs comportement historique.
  const shouldSendSlack =
    !wasAwaiting &&
    row.status === "done" &&
    !row.slack_sent_at;
  if (shouldSendSlack) {
    const slackRes = await sendSalesCoachSlack(db, id).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!slackRes.ok) {
      console.warn(`[resolve-deal/${id}] Slack send after deal attribution failed:`, slackRes.error);
    }
  }

  return NextResponse.json({
    ok: true,
    dealId,
    name: snapshot?.name ?? null,
    started: wasAwaiting,
  });
}
