import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

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
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} → ${res.status}`);
  return res.json();
}

const PROPS = [
  "firstname", "lastname", "email", "jobtitle", "company",
  "industry", "lifecyclestage", "city", "country",
  "notes_last_contacted", "hs_lead_status", "numberofemployees", "hs_lead_source",
];

type HsFilter = { propertyName: string; operator: string; value?: string; highValue?: string };

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const lifecyclestage = searchParams.get("lifecyclestage")?.trim() ?? "";
  const industry = searchParams.get("industry")?.trim() ?? "";
  const country = searchParams.get("country")?.trim() ?? "";
  const leadstatus = searchParams.get("leadstatus")?.trim() ?? "";
  const contacted = searchParams.get("contacted")?.trim() ?? "";
  const companysize = searchParams.get("companysize")?.trim() ?? "";
  const source = searchParams.get("source")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "";
  const after = searchParams.get("after")?.trim() ?? "";

  const filters: HsFilter[] = [];
  if (lifecyclestage) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: lifecyclestage });
  if (industry) filters.push({ propertyName: "industry", operator: "EQ", value: industry });
  if (country) filters.push({ propertyName: "country", operator: "EQ", value: country });
  if (leadstatus) filters.push({ propertyName: "hs_lead_status", operator: "EQ", value: leadstatus });
  if (source) filters.push({ propertyName: "hs_lead_source", operator: "EQ", value: source });

  if (companysize) {
    const ranges: Record<string, [number, number | null]> = {
      "1-10": [1, 10], "11-50": [11, 50], "51-200": [51, 200],
      "201-1000": [201, 1000], "1000+": [1001, null],
    };
    const range = ranges[companysize];
    if (range) {
      filters.push({ propertyName: "numberofemployees", operator: "GTE", value: String(range[0]) });
      if (range[1]) filters.push({ propertyName: "numberofemployees", operator: "LTE", value: String(range[1]) });
    }
  }

  const now = Date.now();
  if (contacted === "never") {
    filters.push({ propertyName: "notes_last_contacted", operator: "NOT_HAS_PROPERTY" });
  } else if (contacted === "lt30") {
    filters.push({ propertyName: "notes_last_contacted", operator: "GTE", value: String(now - 30 * 864e5) });
  } else if (contacted === "30to90") {
    filters.push({ propertyName: "notes_last_contacted", operator: "BETWEEN", value: String(now - 90 * 864e5), highValue: String(now - 30 * 864e5) });
  } else if (contacted === "gt90") {
    filters.push({ propertyName: "notes_last_contacted", operator: "LTE", value: String(now - 90 * 864e5) });
  }

  const sortMap: Record<string, string> = {
    alpha: "firstname", lastcontact: "notes_last_contacted", recent: "hs_lastmodifieddate",
  };

  const body: Record<string, unknown> = {
    limit: 50,
    properties: PROPS,
    sorts: [{ propertyName: sortMap[sort] ?? "hs_lastmodifieddate", direction: sort === "alpha" ? "ASCENDING" : "DESCENDING" }],
  };
  if (q) body.query = q;
  if (filters.length) body.filterGroups = [{ filters }];
  if (after) body.after = after;

  const data = await hubspot("/crm/v3/objects/contacts/search", "POST", body);

  const results = (data.results ?? []).map((c: {
    id: string;
    properties: Record<string, string>;
  }) => ({
    id: c.id,
    firstName: c.properties.firstname ?? "",
    lastName: c.properties.lastname ?? "",
    email: c.properties.email ?? "",
    jobTitle: c.properties.jobtitle ?? "",
    company: c.properties.company ?? "",
    industry: c.properties.industry ?? "",
    lifecyclestage: c.properties.lifecyclestage ?? "",
    city: c.properties.city ?? "",
    country: c.properties.country ?? "",
    lastContacted: c.properties.notes_last_contacted ?? "",
    leadStatus: c.properties.hs_lead_status ?? "",
    employees: c.properties.numberofemployees ?? "",
    source: c.properties.hs_lead_source ?? "",
  }));

  const nextCursor: string | null = (data.paging as { next?: { after?: string } } | undefined)?.next?.after ?? null;
  const total: number | null = data.total ?? null;

  return NextResponse.json({ results, nextCursor, total });
}
