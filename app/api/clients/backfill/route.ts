import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { backfillClosedWonDeals } from "@/lib/clients/backfill";
import { triggerPrepareMeetings } from "@/lib/clients/trigger-prepare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/clients/backfill
// Body: { since?: "YYYY-MM-DD", limit?: number }
//
// Importe les closed-won historiques depuis HubSpot vers la table clients.
// Admin-only. Ne déclenche PAS l'enrichissement Claude (les rows sont créées
// en status='pending', l'admin les enrichit ensuite via le bouton sur la
// fiche). Idempotent : repasse les deals déjà importés sans erreur.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  if (!userRow?.is_admin) {
    return NextResponse.json({ error: "Admin requis" }, { status: 403 });
  }

  let dealIds: string[] = [];
  try {
    const body = (await req.json().catch(() => ({}))) as { dealIds?: unknown };
    if (Array.isArray(body.dealIds)) {
      dealIds = body.dealIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // ignore : body optionnel
  }

  if (dealIds.length === 0) {
    return NextResponse.json({ error: "dealIds requis (liste non vide)" }, { status: 400 });
  }

  try {
    const stats = await backfillClosedWonDeals({ dealIds });

    // Garde-fou meetings : pour chaque client créé, on déclenche la découverte
    // des meetings Claap + DM Slack à l'AE (la row passe en 'awaiting_meetings').
    // L'analyse ne démarrera qu'après confirmation depuis la fiche.
    for (const clientId of stats.importedClientIds) {
      await triggerPrepareMeetings(clientId, req.nextUrl.origin);
    }

    // Import d'un seul deal : on renvoie son id pour que l'UI ouvre directement
    // le popup de confirmation des meetings. Import multiple : confirmation
    // différée sur chaque fiche (les AE sont notifiés par Slack).
    const singleClientId = stats.importedClientIds.length === 1 ? stats.importedClientIds[0] : null;
    return NextResponse.json({ ok: true, ...stats, singleClientId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[clients/backfill] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
