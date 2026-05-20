import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  hubspot_owner_id: string | null;
  slack_display_name: string | null;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await db
    .from("users")
    .select("id, name, email, hubspot_owner_id, slack_display_name")
    .not("hubspot_owner_id", "is", null)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message, users: [] }, { status: 500 });
  }

  const users = ((data ?? []) as UserRow[]).map((u) => ({
    id: u.id,
    name: u.name ?? u.email ?? "Sans nom",
    hubspotOwnerId: u.hubspot_owner_id,
    slackDisplayName: u.slack_display_name,
  }));

  return NextResponse.json({ users, myUserId: user.id });
}
