import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClaapRecording, pickTranscriptUrl } from "@/lib/claap";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Lance l'analyse Sales Coach d'un meeting SANS deal HubSpot.
 *
 * Déclenché par le bouton "Analyser quand même" de l'écran
 * `awaiting_manual_deal` (résolveur auto KO). On ne tente PAS de retrouver un
 * deal (contrairement à `reanalyze`, qui reforce `awaiting_manual_deal` si la
 * résolution échoue) : on passe la ligne en `pending` et on déclenche l'analyse
 * directement. `runSalesCoachAnalysis` gère un `hubspot_deal_id` nul (pas de
 * snapshot deal, DM Slack sauté, recap meeting envoyé quand même).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("id, claap_recording_id, status")
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.claap_recording_id) {
    return NextResponse.json({ error: "No Claap recording linked" }, { status: 400 });
  }
  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "CLAAP_API_TOKEN not configured" }, { status: 500 });
  }

  // Re-fetch le recording pour récupérer le transcriptUrl (textUrl valide 24h
  // côté Claap, jamais stocké dans la ligne).
  const rec = await getClaapRecording(row.claap_recording_id).catch(() => null);
  const transcriptUrl = rec ? pickTranscriptUrl(rec) : null;
  if (!transcriptUrl) {
    return NextResponse.json({ error: "No transcript available on Claap" }, { status: 400 });
  }

  // Passe en `pending` pour lancer l'analyse. On garde hubspot_deal_id à null.
  const { error: updateErr } = await db
    .from("sales_coach_analyses")
    .update({
      status: "pending",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Déclenchement de l'analyse (background sur Netlify, route inline en dev).
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.warn("[analyze-without-deal] INTERNAL_SECRET missing — analysis won't start");
    return NextResponse.json({ error: "INTERNAL_SECRET not configured" }, { status: 500 });
  }

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
      console.error(`[analyze-without-deal] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[analyze-without-deal] trigger fetch failed:", msg);
    }
  }

  return NextResponse.json({ ok: true, started: true });
}
