import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

type HsFilter = { propertyName: string; operator: string; value?: string };

// Autocomplétion société : renvoie les noms de sociétés distincts présents
// sur les contacts de l'utilisateur, pour alimenter le combobox de filtre.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const ownerParam = searchParams.get("owner"); // null = mine, "all" = no filter, id = specific

  const filters: HsFilter[] = [];
  if (ownerParam === "all") {
    // No owner filter
  } else if (ownerParam) {
    filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerParam });
  } else {
    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
    const myOwnerId = userRow?.hubspot_owner_id ?? null;
    if (myOwnerId) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: myOwnerId });
  }

  // On exige une société renseignée pour ne pas remonter de contacts vides.
  filters.push({ propertyName: "company", operator: "HAS_PROPERTY" });
  if (q) filters.push({ propertyName: "company", operator: "CONTAINS_TOKEN", value: `*${q}*` });

  const body: Record<string, unknown> = {
    limit: 100,
    properties: ["company"],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    filterGroups: [{ filters }],
  };

  try {
    const data = await hubspot("/crm/v3/objects/contacts/search", "POST", body);

    const counts = new Map<string, { name: string; n: number }>();
    for (const c of (data.results ?? []) as { properties: Record<string, string> }[]) {
      const name = (c.properties.company ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { name, n: 1 });
    }

    const companies = Array.from(counts.values())
      .sort((a, b) => b.n - a.n)
      .slice(0, 20)
      .map((e) => e.name);

    return NextResponse.json({ companies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur HubSpot", companies: [] }, { status: 500 });
  }
}
