import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch, hubspotUpdate } from "@/lib/hubspot";
import { stripEmDashes } from "@/lib/no-em-dash";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Écrit la raison de perte corrigée (proposée par l'analyse de perte) dans la
// propriété HubSpot closed_lost_reason. Uniquement au clic sur "Write to
// HubSpot" dans la fiche, jamais automatiquement.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  const value = stripEmDashes((reason ?? "").trim()).slice(0, 500);
  if (!value) return NextResponse.json({ error: "Reason missing" }, { status: 400 });

  try {
    const deal = await hubspotFetch<{ properties?: { hs_is_closed_lost?: string } }>(
      `/crm/v3/objects/deals/${id}?properties=hs_is_closed_lost`,
    );
    if (deal.properties?.hs_is_closed_lost !== "true") {
      return NextResponse.json({ error: "This deal is not closed lost" }, { status: 400 });
    }
    await hubspotUpdate("deals", id, { closed_lost_reason: value });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 500 });
  }

  const writtenAt = new Date().toISOString();
  // Trace best-effort : l'écriture HubSpot a réussi, c'est elle qui compte.
  await db.from("deal_loss_analyses").update({ hubspot_reason_written_at: writtenAt }).eq("deal_id", id);
  return NextResponse.json({ ok: true, reason: value, writtenAt });
}
