import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";
import { loadRadarKeys, matchContactAgainstRadar } from "@/lib/radar-overlap";
import type { HubspotCriteria } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/intel/enrich/hubspot-count
// Compteur exact des contacts qui matchent les critères.
// Gère aussi les filtres deal en faisant la jointure deals → contacts associés.

const MAX_DEAL_SAMPLE = 500; // hard limit pour borner le coût
const RADAR_SCAN_CAP = 300;  // borne pour le calcul de l'overlap Radar

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

  // ── 1. Build contact-side filters
  const filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [];

  if (owners.length === 1) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owners[0] });
  if (owners.length > 1) filters.push({ propertyName: "hubspot_owner_id", operator: "IN", values: owners });

  if (c.lifecyclestage?.length === 1) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: c.lifecyclestage[0] });
  else if (c.lifecyclestage && c.lifecyclestage.length > 1)
    filters.push({ propertyName: "lifecyclestage", operator: "IN", values: c.lifecyclestage });

  if (c.industry?.length) filters.push({ propertyName: "industry", operator: "IN", values: c.industry });
  if (c.country?.length) filters.push({ propertyName: "country", operator: "IN", values: c.country });
  if (c.companysize?.length) filters.push({ propertyName: "numberofemployees", operator: "IN", values: c.companysize });

  const cutoff = c.createdRange === "custom" ? c.createdFrom : rangeCutoff(c.createdRange);
  if (cutoff) filters.push({ propertyName: "createdate", operator: "GTE", value: cutoff });

  if (c.hasLinkedin === true) filters.push({ propertyName: "linkedin_url", operator: "HAS_PROPERTY" });
  if (c.hasLinkedin === false) filters.push({ propertyName: "linkedin_url", operator: "NOT_HAS_PROPERTY" });

  if (c.neverContacted) filters.push({ propertyName: "notes_last_contacted", operator: "NOT_HAS_PROPERTY" });
  if (typeof c.daysSinceLastContact === "number" && c.daysSinceLastContact > 0) {
    const lastCutoff = new Date(Date.now() - c.daysSinceLastContact * 86_400_000).toISOString();
    filters.push({ propertyName: "notes_last_contacted", operator: "LTE", value: lastCutoff });
  }

  // ── 2. If deal filter → fetch deals, batch associations, restrict to those contacts
  const wantsDealFilter = (c.dealStages && c.dealStages.length > 0) || (c.dealStatus && c.dealStatus !== "any");

  let deal_total: number | null = null;
  let truncated = false;

  if (wantsDealFilter) {
    const dealFilters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [];

    if (c.dealStages && c.dealStages.length > 0) {
      dealFilters.push({ propertyName: "dealstage", operator: "IN", values: c.dealStages });
    } else if (c.dealStatus === "closed-won") {
      dealFilters.push({ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" });
    } else if (c.dealStatus === "closed-lost") {
      dealFilters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "true" });
      dealFilters.push({ propertyName: "hs_is_closed_won", operator: "EQ", value: "false" });
    } else if (c.dealStatus === "open") {
      dealFilters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "false" });
    }

    if (owners.length === 1) dealFilters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owners[0] });
    else if (owners.length > 1) dealFilters.push({ propertyName: "hubspot_owner_id", operator: "IN", values: owners });

    try {
      // First call : just count deals matching
      const dealCountRes = await hubspotFetch<{ total: number }>(`/crm/v3/objects/deals/search`, "POST", {
        filterGroups: dealFilters.length ? [{ filters: dealFilters }] : undefined,
        properties: ["dealname"],
        limit: 1,
      });
      deal_total = dealCountRes.total ?? 0;

      // Truncate sample
      truncated = deal_total > MAX_DEAL_SAMPLE;

      // Fetch deal IDs (max MAX_DEAL_SAMPLE)
      const deals = await hubspotSearchAll<{ id: string }>(
        "deals",
        {
          properties: ["dealname"],
          filterGroups: dealFilters.length ? [{ filters: dealFilters }] : undefined,
          sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
          limit: 100,
        },
        MAX_DEAL_SAMPLE
      );

      const dealIds = deals.map((d) => d.id);
      if (dealIds.length === 0) {
        return NextResponse.json({ count: 0, dealCount: 0, truncated: false });
      }

      // Batch associations deals → contacts
      const batchResp = await hubspotFetch<{
        results?: { from: { id: string }; to: { toObjectId: string }[] }[];
      }>(`/crm/v4/associations/deals/contacts/batch/read`, "POST", {
        inputs: dealIds.slice(0, 200).map((id) => ({ id })),
      }).catch(() => ({ results: [] }));

      const contactIds = new Set<string>();
      for (const r of batchResp.results ?? []) {
        for (const t of r.to ?? []) contactIds.add(String(t.toObjectId));
      }

      if (contactIds.size === 0) {
        return NextResponse.json({ count: 0, dealCount: deal_total, truncated, radarCount: 0 });
      }

      // HubSpot limite les `values` à ~100 par filtre. Si on a plus de contactIds,
      // on retourne directement contactIds.size (estimation max, sans appliquer les autres filtres contact).
      // L'utilisateur verra le compteur "des deals matchés" — assez précis pour un filtre déjà étroit.
      if (contactIds.size > 100) {
        return NextResponse.json({
          count: contactIds.size,
          dealCount: deal_total,
          truncated: true,
          approximated: true,
          radarCount: null,
          radarApproximated: true,
        });
      }

      filters.push({ propertyName: "hs_object_id", operator: "IN", values: Array.from(contactIds) });
    } catch (e) {
      console.error("[hubspot-count] deal filter error:", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur deals" }, { status: 500 });
    }
  }

  // ── 3. Final count of contacts + overlap avec le Radar (en parallèle)
  try {
    const radarKeys = await loadRadarKeys(db);

    const baseBody = {
      filterGroups: filters.length ? [{ filters }] : undefined,
      ...(c.q?.trim() ? { query: c.q.trim() } : {}),
    };

    // On échantillonne TOUS les contacts qui matchent (pas seulement ceux
    // avec linkedin_url) — l'overlap se calcule désormais aussi via
    // hubspot_id et nom+entreprise, donc le linkedin_url n'est plus requis.
    const shouldScanRadar = radarKeys.size > 0;

    interface SampleRow {
      id: string;
      properties: { firstname?: string; lastname?: string; company?: string; linkedin_url?: string };
    }

    const [countData, sampleRows] = await Promise.all([
      hubspotFetch<{ total: number }>(`/crm/v3/objects/contacts/search`, "POST", {
        ...baseBody,
        properties: ["firstname"],
        limit: 1,
      }),
      shouldScanRadar
        ? hubspotSearchAll<SampleRow>(
            "contacts",
            {
              ...baseBody,
              properties: ["firstname", "lastname", "company", "linkedin_url"],
              limit: 100,
            },
            RADAR_SCAN_CAP,
          ).catch(() => [] as SampleRow[])
        : Promise.resolve([] as SampleRow[]),
    ]);

    const total = countData.total ?? 0;

    let radarHits = 0;
    for (const row of sampleRows) {
      const p = row.properties ?? {};
      const res = matchContactAgainstRadar(
        {
          hubspotId: row.id,
          firstName: p.firstname,
          lastName: p.lastname,
          company: p.company,
          linkedinUrl: p.linkedin_url,
        },
        radarKeys,
      );
      if (res.matched) radarHits++;
    }

    // Si le sample ne couvre qu'une fraction des contacts, on extrapole
    // linéairement pour donner une estimation utile.
    const radarApproximated = sampleRows.length > 0 && total > sampleRows.length;
    const radarCount = radarApproximated
      ? Math.round((radarHits / sampleRows.length) * total)
      : radarHits;

    return NextResponse.json({
      count: total,
      dealCount: deal_total,
      truncated,
      radarCount,
      radarApproximated,
    });
  } catch (e) {
    console.error("[hubspot-count] contact search error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
