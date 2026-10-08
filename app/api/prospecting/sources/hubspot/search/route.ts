import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchHubspotContacts } from "@/lib/prospecting/sources/hubspot";

export const dynamic = "force-dynamic";

// GET /api/prospecting/sources/hubspot/search
// Mêmes paramètres que /api/prospection/search : q, company, lifecyclestage,
// industry, country, leadstatus, contacted, companysize, source, createdyear,
// sort, after, owner (absent = mes contacts, "all" = tous, sinon id owner).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  try {
    const result = await searchHubspotContacts(user.id, {
      q: get("q"),
      company: get("company"),
      jobtitle: get("jobtitle"),
      lifecyclestage: get("lifecyclestage"),
      industry: get("industry"),
      country: get("country"),
      leadstatus: get("leadstatus"),
      contacted: get("contacted"),
      companysize: get("companysize"),
      source: get("source"),
      createdyear: get("createdyear"),
      sort: get("sort"),
      after: get("after"),
      owner: sp.get("owner"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `HubSpot search failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
