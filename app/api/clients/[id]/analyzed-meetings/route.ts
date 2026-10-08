import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { RefreshReport } from "@/lib/clients/types";

export const dynamic = "force-dynamic";

type AnalyzedMeeting = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  hubspot_deal_id: string | null;
  claap_url: string | null;
  // true si le meeting est passé par le pipeline sales-coach (transcript
  // analysé, recap généré). false s'il n'est qu'inclus via la discovery
  // Claap (matché par domaine/titre, transcript brut injecté au prompt mais
  // pas de recap structuré).
  has_recap: boolean;
};

// GET /api/clients/[id]/analyzed-meetings
//
// Liste TOUS les meetings Claap qui ont contribué aux données de ce client :
// analysés par sales-coach (matchés par hubspot_deal_id, deals liés lus au
// dernier refresh compris (deal Customer Success créé après le closed-won), OU
// hubspot_company_id) + ceux inclus via la discovery mais sans recap. Sert le
// bouton "info" de la fiche, pour vérifier ce que le refresh a réellement pris
// en compte.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, hubspot_deal_id, hubspot_company_id, confirmed_claap_recordings, discovered_claap_recordings, last_refresh_report")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  let query = db
    .from("sales_coach_analyses")
    .select("claap_recording_id, meeting_title, meeting_started_at, meeting_kind, audience, hubspot_deal_id")
    .eq("status", "done");
  const report = client.last_refresh_report as RefreshReport | null;
  const dealIds = [...new Set([client.hubspot_deal_id as string, ...(report?.sources?.hubspot?.deals ?? []).map((d) => d.id)])]
    .filter((d) => /^\d+$/.test(d));
  const dealFilter = `hubspot_deal_id.in.(${dealIds.join(",")})`;
  query = client.hubspot_company_id
    ? query.or(`${dealFilter},hubspot_company_id.eq.${client.hubspot_company_id}`)
    : query.or(dealFilter);

  const { data: analyzed, error: analyzedErr } = await query.order("meeting_started_at", { ascending: false });
  if (analyzedErr) {
    return NextResponse.json({ error: analyzedErr.message }, { status: 500 });
  }

  const urlByRecordingId = new Map<string, string | null>();
  for (const r of [
    ...(Array.isArray(client.confirmed_claap_recordings) ? client.confirmed_claap_recordings : []),
    ...(Array.isArray(client.discovered_claap_recordings) ? client.discovered_claap_recordings : []),
  ]) {
    if (r?.recording_id) urlByRecordingId.set(r.recording_id, r.claap_url ?? null);
  }

  const seen = new Set<string>();
  const meetings: AnalyzedMeeting[] = [];

  for (const r of analyzed ?? []) {
    if (!r.claap_recording_id || seen.has(r.claap_recording_id)) continue;
    seen.add(r.claap_recording_id);
    meetings.push({
      recording_id: r.claap_recording_id,
      meeting_title: r.meeting_title,
      meeting_started_at: r.meeting_started_at,
      meeting_kind: r.meeting_kind,
      audience: r.audience,
      hubspot_deal_id: r.hubspot_deal_id,
      claap_url: urlByRecordingId.get(r.claap_recording_id) ?? null,
      has_recap: true,
    });
  }

  // Inclus via discovery mais jamais passés par sales-coach (pas de recap).
  for (const r of Array.isArray(client.discovered_claap_recordings) ? client.discovered_claap_recordings : []) {
    if (!r?.recording_id || seen.has(r.recording_id)) continue;
    seen.add(r.recording_id);
    meetings.push({
      recording_id: r.recording_id,
      meeting_title: r.meeting_title,
      meeting_started_at: r.meeting_started_at,
      meeting_kind: null,
      audience: null,
      hubspot_deal_id: null,
      claap_url: r.claap_url ?? null,
      has_recap: false,
    });
  }

  meetings.sort((a, b) => {
    const da = a.meeting_started_at ? new Date(a.meeting_started_at).getTime() : 0;
    const db2 = b.meeting_started_at ? new Date(b.meeting_started_at).getTime() : 0;
    return db2 - da;
  });

  return NextResponse.json({ meetings });
}
