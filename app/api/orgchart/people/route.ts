import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPerson, getPerson } from "@/lib/orgchart/db";
import { linkPersonToHubspot } from "@/lib/orgchart/hubspot-link";
import type { OrgPersonInput } from "@/lib/orgchart/types";

export const dynamic = "force-dynamic";

// POST /api/orgchart/people { accountId, pushHubspot?, ...fields } -> { person }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { accountId?: string; pushHubspot?: boolean } & OrgPersonInput;
  const { accountId, pushHubspot, ...fields } = body;
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  try {
    let person = await createPerson(accountId, fields);
    // Manual add -> crée aussi le contact HubSpot (sans reveal) et l'associe.
    if (pushHubspot) {
      const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).maybeSingle();
      await linkPersonToHubspot(person.id, accountId, userRow?.hubspot_owner_id ?? null);
      person = (await getPerson(person.id)) ?? person;
    }
    return NextResponse.json({ person }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
