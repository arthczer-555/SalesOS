import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createCompany, hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

// POST /api/hubspot/companies  { name, domain? } -> { company: { id, name, domain } }
// Crée une company HubSpot. Domaine grand public ignoré (jamais posé).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: string; domain?: string } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  let domain = body?.domain?.trim().toLowerCase() || null;
  if (domain && PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(domain)) domain = null;

  try {
    // Dédoublonnage best-effort avant création : domaine exact si fourni, sinon
    // nom exact. HubSpot ne déduplique pas les companies à la création.
    const filterGroups = domain
      ? [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }]
      : [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }];
    const existing = await hubspotSearchAll<{ id: string; properties: Record<string, string> }>(
      "companies",
      { properties: ["name", "domain"], filterGroups, limit: 1 },
      1,
    );
    if (existing[0]) {
      const p = existing[0].properties ?? {};
      return NextResponse.json({
        company: { id: existing[0].id, name: p.name ?? name, domain: p.domain ?? domain },
        deduped: true,
      });
    }

    const id = await createCompany(name, domain);
    return NextResponse.json({ company: { id, name, domain } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 502 });
  }
}
