import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runClientEnrichment } from "@/lib/clients/run-enrichment";
import type { ConfirmedRecording } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/confirm-meetings
// Body: { recordings: ConfirmedRecording[] }
//
// L'humain a validé la liste des meetings Claap (gardés depuis les candidats
// découverts + ajoutés via recherche/URL). On persiste ce set, on stamp la
// confirmation, et on lance l'enrichissement IA sur EXACTEMENT ces meetings.
//
// Ouvert à toute personne authentifiée (pas admin-only) : n'importe qui qui
// importe un client doit pouvoir confirmer ses meetings (cf. décision produit).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  // Normalise le payload : on ne fait confiance qu'à recording_id, le reste est
  // de l'affichage (titre/date/url) qu'on garde tel quel pour la fiche.
  const recordings: ConfirmedRecording[] = [];
  try {
    const body = (await req.json().catch(() => ({}))) as { recordings?: unknown };
    if (Array.isArray(body.recordings)) {
      const seen = new Set<string>();
      for (const r of body.recordings) {
        if (!r || typeof r !== "object") continue;
        const rec = r as Record<string, unknown>;
        const recordingId = typeof rec.recording_id === "string" ? rec.recording_id.trim() : "";
        if (!recordingId || seen.has(recordingId)) continue;
        seen.add(recordingId);
        recordings.push({
          recording_id: recordingId,
          meeting_title: typeof rec.meeting_title === "string" ? rec.meeting_title : null,
          meeting_started_at: typeof rec.meeting_started_at === "string" ? rec.meeting_started_at : null,
          claap_url: typeof rec.claap_url === "string" ? rec.claap_url : null,
          added_manually: rec.added_manually === true,
        });
      }
    }
  } catch {
    // body invalide → recordings reste vide (confirmation "aucun meeting")
  }

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, enrichment_status")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }
  if (client.enrichment_status === "running") {
    return NextResponse.json({ ok: true, already_running: true }, { status: 409 });
  }

  // Persiste le set confirmé + bascule en 'running' (le pipeline reprendra le
  // verrou, mais on l'écrit ici pour que la fiche affiche immédiatement l'état).
  const { error: updErr } = await db
    .from("clients")
    .update({
      confirmed_claap_recordings: recordings,
      meetings_confirmed_at: new Date().toISOString(),
      meetings_confirmed_by: user.email ?? user.id,
      enrichment_status: "pending",
      enrichment_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    // Dev : fire-and-forget inline. La fiche poll en SWR sur enrichment_status.
    void runClientEnrichment(id, user.id).catch((e) => {
      console.error(`[clients/confirm-meetings/${id}] inline run failed:`, e instanceof Error ? e.message : e);
    });
    return NextResponse.json({ ok: true, mode: "inline", confirmed: recordings.length }, { status: 202 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET manquant" }, { status: 500 });
  }

  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/clients-enrich-background`;
  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id, userId: user.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[clients/confirm-meetings/${id}] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[clients/confirm-meetings/${id}] bg trigger failed:`, msg);
    }
  }

  return NextResponse.json({ ok: true, mode: "background", confirmed: recordings.length }, { status: 202 });
}
