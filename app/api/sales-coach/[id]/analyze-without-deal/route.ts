import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClaapRecording, pickTranscriptUrl } from "@/lib/claap";
import { triggerSalesCoachAnalysis } from "@/lib/sales-coach/trigger-analysis";

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
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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
  const trigger = await triggerSalesCoachAnalysis({
    origin: req.nextUrl.origin,
    id,
    transcriptUrl,
    logTag: "analyze-without-deal",
  });
  if (!trigger.ok) {
    return NextResponse.json({ error: trigger.error ?? "Could not start the analysis" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, started: true });
}
