// Dashboard personnel : le snapshot AE Activity du seul utilisateur connecté.
//
// Aucun nouveau pipeline de données — on relit `ae_activity_snapshots`, déjà
// calculé par le refresh, filtré sur le hubspot_owner_id de l'appelant. Pas de
// garde admin : chacun voit ses propres chiffres.
//
// La construction vit dans lib/dashboard/me.ts, partagée avec la vue « voir
// comme » de l'admin : les deux doivent rendre strictement la même chose.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { buildMeDashboard } from "@/lib/dashboard/me";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await buildMeDashboard(user.id));
}
