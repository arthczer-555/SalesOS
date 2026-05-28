import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";
import type { HubspotCriteria } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/intel/enrich/hubspot-preview
// Renvoie un échantillon léger (5 contacts max) qui matchent les critères.
// Utilisé pour l'aperçu live dans l'UI des filtres.

const PREVIEW_LIMIT = 5;
const PREVIEW_PROPS = ["firstname", "lastname", "email", "jobtitle", "company", "lifecyclestage", "hubspot_owner_id"];

interface RawContact {
  id: string;
  properties: Record<string, string>;
}

function rangeCutoff(range: HubspotCriteria["createdRange"]): string | null {
  const now = Date.now();
  switch (range) {
    case "7d":
      return new Date(now - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now - 30 * 86_400_000).toISOString();
    case "90d":
      return new Date(now - 90 * 86_400_000).toISOString();
    case "year": {
      const d = new Date();
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const c = (await req.json().catch(() => ({}))) as HubspotCriteria;

  let owners = (c.owner ?? []).filter(Boolean);
  if (owners.length === 0) {
    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
    if (userRow?.hubspot_owner_id) owners = [userRow.hubspot_owner_id];
  }

  const filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [];
  if (owners.length === 1) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owners[0] });
  if (owners.length > 1) filters.push({ propertyName: "hubspot_owner_id", operator: "IN", values: owners });
  if (c.lifecyclestage?.length === 1) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: c.lifecyclestage[0] });
  else if (c.lifecyclestage && c.lifecyclestage.length > 1)
    filters.push({ propertyName: "lifecyclestage", operator: "IN", values: c.lifecyclestage });
  if (c.industry?.length) filters.push({ propertyName: "industry", operator: "IN", values: c.industry });
  if (c.country?.length) filters.push({ propertyName: "country", operator: "IN", values: c.country });
  if (c.companysize?.length) filters.push({ propertyName: "numberofemployees", operator: "IN", values: c.companysize });
  if (c.companies?.length) filters.push({ propertyName: "company", operator: "IN", values: c.companies });

  const cutoff = c.createdRange === "custom" ? c.createdFrom : rangeCutoff(c.createdRange);
  if (cutoff) filters.push({ propertyName: "createdate", operator: "GTE", value: cutoff });

  if (c.hasLinkedin === true) filters.push({ propertyName: "linkedin_url", operator: "HAS_PROPERTY" });
  if (c.hasLinkedin === false) filters.push({ propertyName: "linkedin_url", operator: "NOT_HAS_PROPERTY" });
  if (c.neverContacted) filters.push({ propertyName: "notes_last_contacted", operator: "NOT_HAS_PROPERTY" });
  if (typeof c.daysSinceLastContact === "number" && c.daysSinceLastContact > 0) {
    const lastCutoff = new Date(Date.now() - c.daysSinceLastContact * 86_400_000).toISOString();
    filters.push({ propertyName: "notes_last_contacted", operator: "LTE", value: lastCutoff });
  }

  const wantsDealFilter = (c.dealStages && c.dealStages.length > 0) || (c.dealStatus && c.dealStatus !== "any");

  if (wantsDealFilter) {
    const dealFilters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [];
    if (c.dealStages && c.dealStages.length > 0) dealFilters.push({ propertyName: "dealstage", operator: "IN", values: c.dealStages });
    else if (c.dealStatus === "closed-won") dealFilters.push({ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" });
    else if (c.dealStatus === "closed-lost") {
      dealFilters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "true" });
      dealFilters.push({ propertyName: "hs_is_closed_won", operator: "EQ", value: "false" });
    } else if (c.dealStatus === "open") dealFilters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "false" });

    if (owners.length === 1) dealFilters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owners[0] });
    else if (owners.length > 1) dealFilters.push({ propertyName: "hubspot_owner_id", operator: "IN", values: owners });

    try {
      const deals = await hubspotSearchAll<{ id: string }>(
        "deals",
        {
          properties: ["dealname"],
          filterGroups: dealFilters.length ? [{ filters: dealFilters }] : undefined,
          sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
          limit: 100,
        },
        100
      );
      const dealIds = deals.map((d) => d.id);
      if (dealIds.length === 0) return NextResponse.json({ profiles: [] });

      const batchResp = await hubspotFetch<{
        results?: { from: { id: string }; to: { toObjectId: string }[] }[];
      }>(`/crm/v4/associations/deals/contacts/batch/read`, "POST", {
        inputs: dealIds.slice(0, 100).map((id) => ({ id })),
      }).catch(() => ({ results: [] }));

      const contactIds = new Set<string>();
      for (const r of batchResp.results ?? []) {
        for (const t of r.to ?? []) contactIds.add(String(t.toObjectId));
      }
      if (contactIds.size === 0) return NextResponse.json({ profiles: [] });
      filters.push({ propertyName: "hs_object_id", operator: "IN", values: Array.from(contactIds).slice(0, 1000) });
    } catch {
      return NextResponse.json({ profiles: [] });
    }
  }

  try {
    const data = await hubspotFetch<{ results: RawContact[] }>(`/crm/v3/objects/contacts/search`, "POST", {
      filterGroups: filters.length ? [{ filters }] : undefined,
      ...(c.q?.trim() ? { query: c.q.trim() } : {}),
      properties: PREVIEW_PROPS,
      limit: PREVIEW_LIMIT,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    });

    const profiles = (data.results ?? []).map((row) => {
      const p = row.properties;
      return {
        hubspotId: row.id,
        fullName: [p.firstname, p.lastname].filter(Boolean).join(" ").trim() || p.email || "—",
        email: p.email ?? null,
        jobTitle: p.jobtitle ?? null,
        company: p.company ?? null,
        lifecyclestage: p.lifecyclestage ?? null,
      };
    });

    return NextResponse.json({ profiles });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
