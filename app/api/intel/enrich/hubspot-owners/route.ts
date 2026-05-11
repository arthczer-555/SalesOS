import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import type { HubspotOwner } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

interface RawOwner {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: userRow } = await db
    .from("users")
    .select("hubspot_owner_id")
    .eq("id", user.id)
    .single();

  try {
    const data = await hubspotFetch<{ results: RawOwner[] }>("/crm/v3/owners?limit=200");
    const owners: HubspotOwner[] = (data.results ?? [])
      .map((o) => ({
        id: o.id,
        name: [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || (o.email ?? "—"),
        email: o.email ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ owners, myOwnerId: userRow?.hubspot_owner_id ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
