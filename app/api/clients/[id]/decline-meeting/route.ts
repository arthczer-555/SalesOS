import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { triggerClientRefresh } from "@/lib/clients/trigger-refresh";
import type { ConfirmedRecording, DiscoveredRecording, RefreshReport } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/decline-meeting
// Body: { recording_id: string }
//
// Retire un meeting Claap des données du client : "Not this account" (meeting
// retenu automatiquement par le refresh, matching domaine / titre trompé) ou
// corbeille de la popup "Claap meetings analyzed" (y compris un meeting analysé
// par sales-coach sous le deal). Il est exclu DÉFINITIVEMENT
// (declined_claap_recording_ids), retiré des listes confirmées/découvertes et
// du report, puis un refresh ré-extrait les fields sans lui (cf.
// removedRecordingIds dans run-refresh.ts). refresh_started = false si la
// fiche n'est pas encore enrichie ou si le refresh n'a pas pu partir.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { recording_id?: unknown };
  const recordingId = typeof body.recording_id === "string" ? body.recording_id.trim() : "";
  if (!recordingId) return NextResponse.json({ error: "recording_id required" }, { status: 400 });

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, enrichment_status, confirmed_claap_recordings, discovered_claap_recordings, declined_claap_recording_ids, last_refresh_report")
    .eq("id", id)
    .single();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const declined = Array.from(new Set([...((client.declined_claap_recording_ids as string[] | null) ?? []), recordingId]));
  const confirmed = ((client.confirmed_claap_recordings as ConfirmedRecording[] | null) ?? []).filter((r) => r.recording_id !== recordingId);
  const discovered = ((client.discovered_claap_recordings as DiscoveredRecording[] | null) ?? []).filter((r) => r.recording_id !== recordingId);
  const report = client.last_refresh_report as RefreshReport | null;
  const nextReport = report
    ? { ...report, auto_added_meetings: (report.auto_added_meetings ?? []).filter((m) => m.recording_id !== recordingId) }
    : null;

  const { error: updErr } = await db
    .from("clients")
    .update({
      declined_claap_recording_ids: declined,
      confirmed_claap_recordings: confirmed,
      discovered_claap_recordings: discovered,
      last_refresh_report: nextReport,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Le refresh ne tourne que sur une fiche enrichie : avant, l'exclusion est
  // appliquée par l'enrichissement (run-enrichment.ts).
  if (client.enrichment_status !== "done") {
    return NextResponse.json({ ok: true, refresh_started: false });
  }
  try {
    const mode = await triggerClientRefresh(req.nextUrl.origin, id, user.id, { removedRecordingIds: [recordingId] });
    return NextResponse.json({ ok: true, refresh_started: true, mode }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ ok: true, refresh_started: false, error: e instanceof Error ? e.message : String(e) }, { status: 202 });
  }
}
