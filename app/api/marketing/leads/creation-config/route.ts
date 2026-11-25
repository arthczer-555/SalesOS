import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { loadCutoverState } from "@/lib/hubspot/cutover";

export const dynamic = "force-dynamic";

// Réglage de création des cartes, lu par la fenêtre de validation des leads :
// legacy (pipeline actuel), prospection (Prospection / R1 scheduled), frozen
// (création suspendue pendant la bascule).
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  try {
    const state = await loadCutoverState();
    return NextResponse.json({ creation: state.values.hubspot_creation, error: null });
  } catch (e) {
    return NextResponse.json({ creation: null, error: e instanceof Error ? e.message : "Settings unavailable" }, { status: 503 });
  }
}
