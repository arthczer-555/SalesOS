import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listSavedLists } from "@/lib/prospecting/sources/lists";

export const dynamic = "force-dynamic";

// GET /api/prospecting/sources/lists -> { lists: SavedListSummary[] }
// Listes sauvegardées de l'utilisateur (enrichment_lists) avec leur compteur.
// Les profils d'une liste : GET /api/prospecting/sources/lists/[id].
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ lists: await listSavedLists(user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load your lists" }, { status: 500 });
  }
}
