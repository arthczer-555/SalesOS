import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchHubspotCompanies } from "@/lib/orgchart/fetch-hubspot-contacts";

export const dynamic = "force-dynamic";

// GET /api/orgchart/hubspot/companies?q=allianz -> { companies: [{id,name,domain}] }
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ companies: [] });
  try {
    const companies = await searchHubspotCompanies(q);
    return NextResponse.json({ companies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", companies: [] }, { status: 500 });
  }
}
