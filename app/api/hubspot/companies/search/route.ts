import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

export interface HubspotCompanyLite {
  id: string;
  name: string;
  domain: string | null;
}

type HubspotCompanyObj = { id: string; properties?: { name?: string; domain?: string } };

// GET /api/hubspot/companies/search?q=<text>   -> type-ahead (max 10)
// GET /api/hubspot/companies/search?id=<id>    -> récupère une company (préselection)
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (id) {
    try {
      const obj = await hubspotFetch<HubspotCompanyObj>(
        `/crm/v3/objects/companies/${encodeURIComponent(id)}?properties=name,domain`,
      );
      return NextResponse.json({
        company: { id: obj.id, name: obj.properties?.name ?? "", domain: obj.properties?.domain ?? null },
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 502 });
    }
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ companies: [] });

  try {
    const rows = await hubspotSearchAll<HubspotCompanyObj>(
      "companies",
      { properties: ["name", "domain"], query: q, limit: 10 },
      10,
    );
    const companies: HubspotCompanyLite[] = rows.map((r) => ({
      id: r.id,
      name: r.properties?.name ?? "",
      domain: r.properties?.domain ?? null,
    }));
    return NextResponse.json({ companies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error", companies: [] }, { status: 502 });
  }
}
