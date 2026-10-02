import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { triggerClientRefresh } from "@/lib/clients/trigger-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/clients/[id]/refresh
//
// Refresh incrémental (bouton "Refresh", le même qui tourne chaque lundi en
// cron) : nouveaux meetings Claap (retenus automatiquement), HubSpot, Slack,
// news ; ré-extrait les fields s'il y a du nouveau, recalcule health + Next
// actions. Ne touche pas enrichment_status (cf. lib/clients/run-refresh.ts).
//
// Action légère/CS : tout utilisateur authentifié (pas admin-only comme
// l'enrich complet). 409 si le client n'a pas encore été enrichi.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, enrichment_status")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (client.enrichment_status !== "done") {
    return NextResponse.json({ error: "Run the enrichment first, then refresh." }, { status: 409 });
  }

  try {
    const mode = await triggerClientRefresh(req.nextUrl.origin, id, user.id);
    return NextResponse.json({ ok: true, mode }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Refresh failed to start" }, { status: 500 });
  }
}
