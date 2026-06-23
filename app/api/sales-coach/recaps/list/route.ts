import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const audienceParam = searchParams.get("audience"); // "prospect" | "client" | null (= all)
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  let query = db
    .from("sales_coach_analyses")
    .select(
      "id, user_id, hubspot_deal_id, meeting_title, meeting_started_at, audience, meeting_recap, meeting_recap_slack_text, meeting_recap_slack_permalink, meeting_recap_slack_sent_at, meeting_recap_slack_recipients, deal_snapshot, participants, created_at",
    )
    .not("meeting_recap", "is", null)
    .neq("meeting_type", "internal")
    .neq("status", "skipped")
    .order("meeting_started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (audienceParam === "prospect" || audienceParam === "client") {
    query = query.eq("audience", audienceParam);
  }

  if (fromParam) query = query.gte("meeting_started_at", fromParam);
  if (toParam) {
    const to = toParam.length === 10 ? `${toParam}T23:59:59.999Z` : toParam;
    query = query.lte("meeting_started_at", to);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Project a lightweight company name + drop the heavy snapshot from the response.
  type Snapshot = { name?: string | null; contacts?: Array<{ firstname?: string; lastname?: string; email?: string }> | null } | null;
  type Row = Record<string, unknown> & { deal_snapshot?: Snapshot };
  const projected = (data ?? []).map((row) => {
    const r = row as Row;
    const company = r.deal_snapshot?.name?.trim() || null;
    const firstContact = r.deal_snapshot?.contacts?.[0];
    const primary_contact = firstContact
      ? {
          name: `${firstContact.firstname ?? ""} ${firstContact.lastname ?? ""}`.trim() || (firstContact.email ?? ""),
          email: firstContact.email ?? "",
        }
      : null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deal_snapshot: _ds, ...rest } = r;
    return { ...rest, company, primary_contact };
  });

  return NextResponse.json({ recaps: projected, isAdmin });
}
