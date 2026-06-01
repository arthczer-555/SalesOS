import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveHubspotOwnerId } from "@/lib/onboarding/resolve-mappings";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const hubspotOwnerId = await resolveHubspotOwnerId(user.email);

    if (hubspotOwnerId) {
      await db.from("users").update({ hubspot_owner_id: hubspotOwnerId }).eq("id", user.id);
    }

    return NextResponse.json({ hubspotOwnerId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
