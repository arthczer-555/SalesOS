import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";
import { resolveUsername } from "@/lib/netrows";
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
  const limit = Math.max(10, Math.min(200, c.limit ?? 100));

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

    // ── 6. Run contact search
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
      limit,
    };
    if (c.q?.trim()) searchBody.query = c.q.trim();

    let contacts = await hubspotSearchAll<RawContact>("contacts", searchBody, limit);

    // ── 7. If we didn't already fetch deals (no deal filter), batch-fetch top deals for these contacts
    if (!wantsDealFilter && contacts.length > 0) {
      const batchResp = await hubspotFetch<{
        results?: { from: { id: string }; to: { toObjectId: string }[] }[];
      }>(`/crm/v4/associations/contacts/deals/batch/read`, "POST", {
        inputs: contacts.slice(0, 100).map((cc) => ({ id: cc.id })),
      }).catch(() => ({ results: [] }));

      const dealIdsToFetch = new Set<string>();
      const contactToDealIds = new Map<string, string[]>();
      for (const r of batchResp.results ?? []) {
        const cid = r.from.id;
        const ids = (r.to ?? []).map((t) => String(t.toObjectId));
        contactToDealIds.set(cid, ids);
        ids.forEach((id) => dealIdsToFetch.add(id));
      }

      if (dealIdsToFetch.size > 0) {
        const dealBatch = await hubspotFetch<{ results?: RawDeal[] }>(
          `/crm/v3/objects/deals/batch/read`,
          "POST",
          {
            properties: DEAL_PROPS,
            inputs: Array.from(dealIdsToFetch).slice(0, 200).map((id) => ({ id })),
          }
        ).catch(() => ({ results: [] }));

        const dealById = new Map<string, RawDeal>();
        for (const d of dealBatch.results ?? []) dealById.set(d.id, d);

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
        company: p.company ?? null,
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

    return NextResponse.json({ profiles, total: profiles.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur HubSpot" }, { status: 500 });
  }
}

function extractLinkedInUsername(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, "") : null;
}
