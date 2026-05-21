import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/outreach/counts
// Body : { emails?: string[], hubspot_ids?: string[] }
// Renvoie : { byEmail: { [email_lower]: number }, byHubspotId: { [id]: number } }
//
// Compte uniquement les envois SalesOS (table outreach_log).
// La requête est scoped par user_id pour ne jamais fuiter des envois d'autres users.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { emails?: unknown; hubspot_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emails = Array.isArray(body.emails)
    ? Array.from(new Set(body.emails.filter((e): e is string => typeof e === "string" && e.includes("@")).map((e) => e.toLowerCase())))
    : [];
  const hubspotIds = Array.isArray(body.hubspot_ids)
    ? Array.from(new Set(body.hubspot_ids.filter((x): x is string => typeof x === "string" && x.length > 0)))
    : [];

  const byEmail: Record<string, number> = {};
  const byHubspotId: Record<string, number> = {};

  if (emails.length > 0) {
    const { data, error } = await db
      .from("outreach_log")
      .select("email_lower")
      .eq("user_id", user.id)
      .in("email_lower", emails);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      const key = (row as { email_lower: string }).email_lower;
      byEmail[key] = (byEmail[key] ?? 0) + 1;
    }
  }

  if (hubspotIds.length > 0) {
    const { data, error } = await db
      .from("outreach_log")
      .select("hubspot_id")
      .eq("user_id", user.id)
      .in("hubspot_id", hubspotIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      const key = (row as { hubspot_id: string | null }).hubspot_id;
      if (key) byHubspotId[key] = (byHubspotId[key] ?? 0) + 1;
    }
  }

  return NextResponse.json({ byEmail, byHubspotId });
}
