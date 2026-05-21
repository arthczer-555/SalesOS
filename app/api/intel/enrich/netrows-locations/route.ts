import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchLocations, extractGeoId } from "@/lib/netrows";

export const dynamic = "force-dynamic";

// Autocomplete pour le filtre geo de l'enrichissement Netrows. Free, pas de
// crédit consommé. L'UI debounce les frappes côté client.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  try {
    const items = await searchLocations(q);
    // On expose à l'UI un format simple : { id (numérique), name }
    return NextResponse.json({
      items: items.map((i) => ({ id: extractGeoId(i.id), name: i.name })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur Netrows" },
      { status: 500 }
    );
  }
}
