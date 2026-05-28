import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listClaapRecordingsPage, pickTranscriptUrl, type ClaapRecording } from "@/lib/claap";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "CLAAP_API_TOKEN not configured" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const scope = searchParams.get("scope"); // "mine" (default) | "all" (admin)
  const cursor = searchParams.get("cursor"); // pagination cursor (optional)

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;
  const wantsAll = scope === "all" && isAdmin;

  let recordings: ClaapRecording[];
  let nextCursor: string | null;
  try {
    const page = await listClaapRecordingsPage({ limit: 50, cursor });
    recordings = page.recordings;
    nextCursor = page.nextCursor;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Claap API error" }, { status: 502 });
  }

  const myEmail = user.email.toLowerCase();
  const filtered = wantsAll
    ? recordings
    : recordings.filter((r) => (r.recorder?.email ?? "").toLowerCase() === myEmail);

  // Lookup which recordings are already analyzed
  const ids = filtered.map((r) => r.id);
  const { data: existing } = ids.length > 0
    ? await db
        .from("sales_coach_analyses")
        .select("id, claap_recording_id, status")
        .in("claap_recording_id", ids)
    : { data: [] };

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.claap_recording_id as string, { id: r.id as string, status: r.status as string }]),
  );

  const items = filtered.map((r) => ({
    id: r.id,
    title: r.title ?? "(sans titre)",
    started_at: r.meeting?.startingAt ?? r.createdAt ?? null,
    duration_seconds: r.durationSeconds ?? null,
    meeting_type: r.meeting?.type ?? null,
    recorder_email: r.recorder?.email ?? null,
    recorder_name: r.recorder?.name ?? null,
    participants: (r.meeting?.participants ?? []).map((p) => ({
      name: p.name ?? null,
      email: p.email ?? null,
      attended: p.attended ?? null,
    })),
    has_transcript: !!pickTranscriptUrl(r),
    state: r.state ?? null,
    claap_url: r.url ?? null,
    existing_analysis: existingMap.get(r.id) ?? null,
  }));

  return NextResponse.json({ recordings: items, isAdmin, nextCursor });
}
