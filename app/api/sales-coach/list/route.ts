import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ownerParam = searchParams.get("owner"); // "all" = admin sees everyone
  const dealParam = searchParams.get("deal"); // filter by hubspot_deal_id
  const fromParam = searchParams.get("from"); // ISO date (inclusive)
  const toParam = searchParams.get("to"); // ISO date (inclusive)

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  let query = db
    .from("sales_coach_analyses")
    .select(
      "id, claap_recording_id, user_id, recorder_email, hubspot_deal_id, meeting_title, meeting_started_at, meeting_type, meeting_kind, status, score_global, slack_sent_at, created_at, error_message, participants, deal_snapshot",
    )
    .neq("meeting_type", "internal")
    .neq("status", "skipped")
    // Client recaps (closed-won / Customer Success deals) skip the coaching
    // analysis — they live only in the Slack recap. Don't surface them here.
    .or("audience.is.null,audience.eq.prospect")
    .order("meeting_started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (ownerParam !== "all") {
    query = query.eq("user_id", user.id);
  }

  if (dealParam) {
    query = query.eq("hubspot_deal_id", dealParam);
  }

  // Date filter on meeting_started_at (fallback to created_at via OR would be
  // complex in PostgREST — filter on meeting_started_at only; rows with NULL
  // started_at are naturally excluded when a date filter is set, which is fine).
  if (fromParam) {
    query = query.gte("meeting_started_at", fromParam);
  }
  if (toParam) {
    // toParam is a date (YYYY-MM-DD); include the whole day
    const to = toParam.length === 10 ? `${toParam}T23:59:59.999Z` : toParam;
    query = query.lte("meeting_started_at", to);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Derive a lightweight `primary_contact` from deal_snapshot so legacy rows
  // (participants still NULL) still display a name + company on list cards.
  // Then drop the heavy deal_snapshot payload from the response.
  type Contact = { firstname?: string; lastname?: string; email?: string };
  type Row = Record<string, unknown> & {
    deal_snapshot?: { contacts?: Contact[] } | null;
  };
  const projected = (data ?? []).map((row) => {
    const r = row as Row;
    const firstContact = r.deal_snapshot?.contacts?.[0];
    const primary_contact = firstContact
      ? {
          name: `${firstContact.firstname ?? ""} ${firstContact.lastname ?? ""}`.trim() || (firstContact.email ?? ""),
          email: firstContact.email ?? "",
        }
      : null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deal_snapshot: _ds, ...rest } = r;
    return { ...rest, primary_contact };
  });

  return NextResponse.json({ analyses: projected, isAdmin });
}
