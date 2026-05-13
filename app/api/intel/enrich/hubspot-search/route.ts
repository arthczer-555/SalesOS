import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";
import { resolveUsername } from "@/lib/netrows";
import { loadRadarKeys, matchContactAgainstRadar, type RadarKeys } from "@/lib/radar-overlap";
import type { EnrichmentProfile, HubspotCriteria } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "company",
  "industry",
  "lifecyclestage",
  "hs_lead_status",
  "createdate",
  "notes_last_contacted",
  "hubspot_owner_id",
  "numberofemployees",
  "hs_lead_source",
  "linkedin_url",
  "city",
  "country",
];

const DEAL_PROPS = ["dealname", "dealstage", "amount", "closedate", "hs_is_closed", "hs_is_closed_won"];

interface OwnerRow {
  id: string;
  firstName?: string;
  lastName?: string;
}

interface PipelineStage {
  id: string;
  label: string;
  metadata?: { isClosed?: string; probability?: string };
}

interface PipelineDef {
  id: string;
  label: string;
  stages: PipelineStage[];
}

interface RawDeal {
  id: string;
  properties: Record<string, string>;
}

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
  const limit = Math.max(10, Math.min(500, c.limit ?? 100));
  const excludeRadar = c.excludeRadar !== false; // défaut true
  const excludeIdSet = new Set(c.excludeIds ?? []);

  // ── 1. Resolve owners (default = me)
  let owners = (c.owner ?? []).filter(Boolean);
  if (owners.length === 0) {
    const { data: userRow } = await db
      .from("users")
      .select("hubspot_owner_id")
      .eq("id", user.id)
      .single();
    if (userRow?.hubspot_owner_id) owners = [userRow.hubspot_owner_id];
  }

  try {
    // ── 2. Build base contact filters (lifecycle, owner, dates, etc.)
    const filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [];

    if (owners.length === 1) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owners[0] });
    if (owners.length > 1) filters.push({ propertyName: "hubspot_owner_id", operator: "IN", values: owners });

    if (c.lifecyclestage?.length === 1) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: c.lifecyclestage[0] });
    else if (c.lifecyclestage && c.lifecyclestage.length > 1)
      filters.push({ propertyName: "lifecyclestage", operator: "IN", values: c.lifecyclestage });

    if (c.leadStatus?.length === 1) filters.push({ propertyName: "hs_lead_status", operator: "EQ", value: c.leadStatus[0] });
    else if (c.leadStatus && c.leadStatus.length > 1)
      filters.push({ propertyName: "hs_lead_status", operator: "IN", values: c.leadStatus });

    if (c.industry?.length) filters.push({ propertyName: "industry", operator: "IN", values: c.industry });
    if (c.country?.length) filters.push({ propertyName: "country", operator: "IN", values: c.country });
    if (c.companysize?.length) filters.push({ propertyName: "numberofemployees", operator: "IN", values: c.companysize });
    if (c.source?.length) filters.push({ propertyName: "hs_lead_source", operator: "IN", values: c.source });

    const cutoff = c.createdRange === "custom" ? c.createdFrom : rangeCutoff(c.createdRange);
    if (cutoff) filters.push({ propertyName: "createdate", operator: "GTE", value: cutoff });
    if (c.createdRange === "custom" && c.createdTo)
      filters.push({ propertyName: "createdate", operator: "LTE", value: c.createdTo });

    if (c.hasLinkedin === true) filters.push({ propertyName: "linkedin_url", operator: "HAS_PROPERTY" });
    if (c.hasLinkedin === false) filters.push({ propertyName: "linkedin_url", operator: "NOT_HAS_PROPERTY" });

    if (c.neverContacted) filters.push({ propertyName: "notes_last_contacted", operator: "NOT_HAS_PROPERTY" });
    if (typeof c.daysSinceLastContact === "number" && c.daysSinceLastContact > 0) {
      const lastCutoff = new Date(Date.now() - c.daysSinceLastContact * 86_400_000).toISOString();
      filters.push({ propertyName: "notes_last_contacted", operator: "LTE", value: lastCutoff });
    }

    // ── 3. Pipeline stages + owners (parallel)
    const [pipelineData, ownersData] = await Promise.all([
      hubspotFetch<{ results: PipelineDef[] }>("/crm/v3/pipelines/deals").catch(() => ({ results: [] })),
      hubspotFetch<{ results: OwnerRow[] }>("/crm/v3/owners?limit=200").catch(() => ({ results: [] as OwnerRow[] })),
    ]);

    const stagesById = new Map<string, PipelineStage & { isWon: boolean }>();
    for (const p of pipelineData.results ?? []) {
      for (const s of p.stages ?? []) {
        stagesById.set(s.id, {
          ...s,
          isWon: parseFloat(s.metadata?.probability ?? "0") === 1,
        });
      }
    }

    const ownerMap = new Map<string, string>();
    for (const o of ownersData.results ?? []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
      if (o.id) ownerMap.set(o.id, name || "—");
    }

    // ── 4. If deal stages filter → search deals first → restrict to associated contacts
    let restrictContactIds: Set<string> | null = null;
    let dealsByContact = new Map<string, RawDeal[]>();

    const wantsDealFilter = (c.dealStages && c.dealStages.length > 0) || (c.dealStatus && c.dealStatus !== "any");

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

      const deals = await hubspotSearchAll<RawDeal>(
        "deals",
        {
          properties: DEAL_PROPS,
          filterGroups: [{ filters: dealFilters }],
          sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
          limit: 100,
        },
        Math.min(500, limit * 5)
      );

      // Get contact ids per deal via batch associations
      const dealIds = deals.map((d) => d.id);
      restrictContactIds = new Set();
      dealsByContact = new Map();

      if (dealIds.length > 0) {
        const batchResp = await hubspotFetch<{
          results?: { from: { id: string }; to: { toObjectId: string }[] }[];
        }>(`/crm/v4/associations/deals/contacts/batch/read`, "POST", {
          inputs: dealIds.slice(0, 200).map((id) => ({ id })),
        }).catch(() => ({ results: [] }));

        for (const r of batchResp.results ?? []) {
          const dealId = r.from.id;
          const deal = deals.find((d) => d.id === dealId);
          if (!deal) continue;
          for (const t of r.to ?? []) {
            const cid = String(t.toObjectId);
            restrictContactIds.add(cid);
            const arr = dealsByContact.get(cid) ?? [];
            arr.push(deal);
            dealsByContact.set(cid, arr);
          }
        }
      }

      if (restrictContactIds.size === 0) {
        return NextResponse.json({ profiles: [], total: 0 });
      }

      // Add the contact-id filter
      filters.push({
        propertyName: "hs_object_id",
        operator: "IN",
        values: Array.from(restrictContactIds).slice(0, 1000),
      });
    }

    // ── 5. Sort
    const sortMap = {
      "createdate-desc": [{ propertyName: "createdate", direction: "DESCENDING" as const }],
      "lastcontacted-desc": [{ propertyName: "notes_last_contacted", direction: "DESCENDING" as const }],
      "lastcontacted-asc": [{ propertyName: "notes_last_contacted", direction: "ASCENDING" as const }],
      "alpha": [{ propertyName: "lastname", direction: "ASCENDING" as const }],
      "deal-amount-desc": [{ propertyName: "createdate", direction: "DESCENDING" as const }],
    };
    const sorts = sortMap[c.sort ?? "createdate-desc"];

    // ── 6. Charge les clés Radar (hubspot_id + username + name+company) pour exclusion
    let radarKeys: RadarKeys = {
      hubspotIds: new Set(),
      usernames: new Set(),
      nameCompanyKeys: new Set(),
      keyToUsername: new Map(),
      size: 0,
    };
    if (excludeRadar) {
      radarKeys = await loadRadarKeys(db);
    }

    // ── 7. Run contact search avec sur-échantillonnage pour absorber le filtrage radar/excludeIds
    const overhead = radarKeys.size + excludeIdSet.size;
    const oversample = Math.min(1000, limit + overhead + 50);

    const searchBody: {
      properties: string[];
      filterGroups?: Array<{ filters: typeof filters }>;
      sorts: typeof sorts;
      query?: string;
      limit: number;
    } = {
      properties: PROPERTIES,
      filterGroups: filters.length ? [{ filters }] : undefined,
      sorts,
      limit: 100, // page size HubSpot (max 100)
    };
    if (c.q?.trim()) searchBody.query = c.q.trim();

    const rawContacts = await hubspotSearchAll<RawContact>("contacts", searchBody, oversample);

    // Filtre client-side : excludeIds + Radar
    let skippedByRadar = 0;
    let skippedByExcludeIds = 0;
    const filteredContacts: RawContact[] = [];
    // Pour backfill opportuniste du hubspot_id sur les rows Radar matchées par nom+entreprise
    const radarBackfill: { username: string; hubspotId: string }[] = [];
    for (const row of rawContacts) {
      if (excludeIdSet.has(row.id)) {
        skippedByExcludeIds++;
        continue;
      }
      if (excludeRadar) {
        const m = matchContactAgainstRadar(
          {
            hubspotId: row.id,
            firstName: row.properties.firstname,
            lastName: row.properties.lastname,
            company: row.properties.company,
            linkedinUrl: row.properties.linkedin_url,
          },
          radarKeys,
        );
        if (m.matched) {
          skippedByRadar++;
          if (m.matchedBy === "name_company" && m.matchedUsername) {
            radarBackfill.push({ username: m.matchedUsername, hubspotId: row.id });
          }
          continue;
        }
      }
      filteredContacts.push(row);
      if (filteredContacts.length >= limit) break;
    }
    let contacts = filteredContacts;

    // Backfill du hubspot_id sur les rows Radar matchées par name+company.
    // Non-bloquant : on lance les updates en parallèle sans attendre.
    if (radarBackfill.length > 0) {
      void Promise.all(
        radarBackfill.map((b) =>
          db
            .from("linkedin_monitored_profiles")
            .update({ hubspot_id: b.hubspotId })
            .eq("username", b.username)
            .is("hubspot_id", null),
        ),
      ).catch((e) => console.error("[hubspot-search] radar hubspot_id backfill failed:", e));
    }
    const hasMore = rawContacts.length >= oversample;

    // ── 8. If we didn't already fetch deals (no deal filter), batch-fetch top deals for these contacts (chunké par 100)
    if (!wantsDealFilter && contacts.length > 0) {
      const contactToDealIds = new Map<string, string[]>();
      const dealIdsToFetch = new Set<string>();

      for (let i = 0; i < contacts.length; i += 100) {
        const chunk = contacts.slice(i, i + 100);
        const batchResp = await hubspotFetch<{
          results?: { from: { id: string }; to: { toObjectId: string }[] }[];
        }>(`/crm/v4/associations/contacts/deals/batch/read`, "POST", {
          inputs: chunk.map((cc) => ({ id: cc.id })),
        }).catch(() => ({ results: [] }));

        for (const r of batchResp.results ?? []) {
          const cid = r.from.id;
          const ids = (r.to ?? []).map((t) => String(t.toObjectId));
          contactToDealIds.set(cid, ids);
          ids.forEach((id) => dealIdsToFetch.add(id));
        }
      }

      if (dealIdsToFetch.size > 0) {
        const allDealIds = Array.from(dealIdsToFetch);
        const fetched: RawDeal[] = [];
        for (let i = 0; i < allDealIds.length; i += 100) {
          const dealBatch = await hubspotFetch<{ results?: RawDeal[] }>(
            `/crm/v3/objects/deals/batch/read`,
            "POST",
            {
              properties: DEAL_PROPS,
              inputs: allDealIds.slice(i, i + 100).map((id) => ({ id })),
            }
          ).catch(() => ({ results: [] }));
          fetched.push(...(dealBatch.results ?? []));
        }

        const dealById = new Map<string, RawDeal>();
        for (const d of fetched) dealById.set(d.id, d);

        dealsByContact = new Map();
        for (const [cid, ids] of contactToDealIds.entries()) {
          const arr = ids.map((id) => dealById.get(id)).filter((x): x is RawDeal => !!x);
          dealsByContact.set(cid, arr);
        }
      }
    }

    // ── 8. Optional: if sort=deal-amount-desc, sort contacts client-side by their top deal amount
    if (c.sort === "deal-amount-desc") {
      const score = (cid: string): number => {
        const deals = dealsByContact.get(cid) ?? [];
        return deals.reduce((max, d) => Math.max(max, parseFloat(d.properties.amount ?? "0") || 0), 0);
      };
      contacts = [...contacts].sort((a, b) => score(b.id) - score(a.id));
    }

    // ── 8.5 Fallback : si le contact n'a pas la propriété `company` remplie,
    // on récupère le nom de la Company associée (objet Company lié au contact).
    // Dans HubSpot, ces deux champs sont distincts et souvent non synchronisés.
    const companyByContact = new Map<string, string>();
    const contactsMissingCompany = contacts.filter((cc) => !cc.properties.company);

    if (contactsMissingCompany.length > 0) {
      const contactToCompanyId = new Map<string, string>();
      const companyIdsToFetch = new Set<string>();

      for (let i = 0; i < contactsMissingCompany.length; i += 100) {
        const chunk = contactsMissingCompany.slice(i, i + 100);
        const batchResp = await hubspotFetch<{
          results?: { from: { id: string }; to: { toObjectId: string }[] }[];
        }>(`/crm/v4/associations/contacts/companies/batch/read`, "POST", {
          inputs: chunk.map((cc) => ({ id: cc.id })),
        }).catch(() => ({ results: [] }));

        for (const r of batchResp.results ?? []) {
          const first = r.to?.[0];
          if (!first) continue;
          const compId = String(first.toObjectId);
          contactToCompanyId.set(r.from.id, compId);
          companyIdsToFetch.add(compId);
        }
      }

      if (companyIdsToFetch.size > 0) {
        const allCompanyIds = Array.from(companyIdsToFetch);
        const companyNameById = new Map<string, string>();
        for (let i = 0; i < allCompanyIds.length; i += 100) {
          const batch = await hubspotFetch<{ results?: { id: string; properties: Record<string, string> }[] }>(
            `/crm/v3/objects/companies/batch/read`,
            "POST",
            {
              properties: ["name"],
              inputs: allCompanyIds.slice(i, i + 100).map((id) => ({ id })),
            }
          ).catch(() => ({ results: [] }));
          for (const co of batch.results ?? []) {
            if (co.properties.name) companyNameById.set(co.id, co.properties.name);
          }
        }

        for (const [cid, compId] of contactToCompanyId.entries()) {
          const name = companyNameById.get(compId);
          if (name) companyByContact.set(cid, name);
        }
      }
    }

    // ── 9. Map to EnrichmentProfile
    let profiles: EnrichmentProfile[] = contacts.map((row) => {
      const p = row.properties;
      const linkedinUrl = p.linkedin_url ?? null;
      const username = linkedinUrl ? extractLinkedInUsername(linkedinUrl) : null;
      const fullName = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
      const deals = dealsByContact.get(row.id) ?? [];
      const top = deals.sort((a, b) => (parseFloat(b.properties.amount ?? "0") || 0) - (parseFloat(a.properties.amount ?? "0") || 0))[0];
      const topStage = top ? stagesById.get(top.properties.dealstage ?? "") : null;
      return {
        hubspotId: row.id,
        username,
        fullName: fullName || p.email || "—",
        firstName: p.firstname,
        lastName: p.lastname,
        email: p.email ?? null,
        company: p.company || companyByContact.get(row.id) || null,
        jobTitle: p.jobtitle ?? null,
        headline: p.jobtitle ?? null,
        lifecyclestage: p.lifecyclestage ?? null,
        leadStatus: p.hs_lead_status ?? null,
        createdAt: p.createdate ?? null,
        ownerId: p.hubspot_owner_id ?? null,
        ownerName: ownerMap.get(p.hubspot_owner_id ?? "") ?? null,
        profileUrl: linkedinUrl,
        source: "hubspot" as const,
        selected: true,
        lastContactedAt: p.notes_last_contacted ?? null,
        numAssociatedDeals: deals.length,
        topDeal: top
          ? {
              id: top.id,
              name: top.properties.dealname ?? "—",
              stage: top.properties.dealstage ?? "—",
              stageLabel: topStage?.label ?? top.properties.dealstage ?? "—",
              amount: top.properties.amount ?? null,
              isClosed: top.properties.hs_is_closed === "true",
              isWon: top.properties.hs_is_closed_won === "true",
            }
          : null,
      };
    });

    // ── 10. Auto-resolve LinkedIn (best-effort, costly) — opt-in
    if (c.autoResolveLinkedin && process.env.NETROWS_API_KEY) {
      const targets = profiles.filter((p) => !p.username);
      const MAX_AUTO = 30;
      for (const p of targets.slice(0, MAX_AUTO)) {
        const username = await resolveUsername({
          email: p.email ?? undefined,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company ?? undefined,
        });
        if (username) {
          p.username = username;
          p.profileUrl = p.profileUrl ?? `https://www.linkedin.com/in/${username}/`;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    return NextResponse.json({
      profiles,
      total: profiles.length,
      skippedByRadar,
      skippedByExcludeIds,
      hasMore,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur HubSpot" }, { status: 500 });
  }
}

function extractLinkedInUsername(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, "") : null;
}
