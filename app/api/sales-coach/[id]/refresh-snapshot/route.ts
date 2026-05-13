import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchDealContext } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

// Fetch the latest HubSpot deal context for an analysis that already has a
// hubspot_deal_id but is missing (or stale) its deal_snapshot. Used to backfill
// old analyses so the UI shows the deal name instead of the raw HubSpot ID.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, hubspot_deal_id")
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.hubspot_deal_id) {
    return NextResponse.json({ error: "No deal linked" }, { status: 400 });
  }

  const snapshot = await fetchDealContext(row.hubspot_deal_id).catch((e) => {
    throw new Error(`HubSpot fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!snapshot) {
    return NextResponse.json({ error: "Deal not found on HubSpot" }, { status: 404 });
  }

  const { error: updateErr } = await db
    .from("sales_coach_analyses")
    .update({ deal_snapshot: snapshot, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, snapshot });
}
