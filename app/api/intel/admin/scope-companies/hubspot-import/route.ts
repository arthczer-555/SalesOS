import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { maybeCreateSalesRep } from "@/lib/scope-companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Filters = {
  q?: string;
  industry?: string[];
  country?: string[];
  lifecyclestage?: string[];
  ownerId?: string;
  employeesMin?: number;
  employeesMax?: number;
  domain?: string;
  // Ajout récent dans HubSpot (createdate >= maintenant - N).
  createdRange?: "7d" | "30d" | "90d" | "year";
  // Tri des résultats.
  sort?: "name" | "created-desc";
};

type HubspotCompanyRow = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

type PreviewCompany = {
  hubspotId: string;
  name: string;
  industry: string | null;
  country: string | null;
  employees: number | null;
  domain: string | null;
  lifecyclestage: string | null;
  ownerId: string | null;
  createdAt: string | null;
  alreadyInScope: boolean;
};

const COMPANY_PROPS = [
  "name",
  "domain",
  "industry",
  "country",
  "numberofemployees",
  "lifecyclestage",
  "hubspot_owner_id",
  "createdate",
];

const RANGE_DAYS: Record<NonNullable<Filters["createdRange"]>, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  year: 365,
};

function toInt(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function buildFilterGroups(f: Filters): Array<{ filters: Array<{ propertyName: string; operator: string; value?: string }> }> {
  const filters: Array<{ propertyName: string; operator: string; value?: string }> = [];
  if (f.ownerId) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: f.ownerId });
  if (typeof f.employeesMin === "number")
    filters.push({ propertyName: "numberofemployees", operator: "GTE", value: String(f.employeesMin) });
  if (typeof f.employeesMax === "number")
    filters.push({ propertyName: "numberofemployees", operator: "LTE", value: String(f.employeesMax) });
  if (f.domain) filters.push({ propertyName: "domain", operator: "CONTAINS_TOKEN", value: f.domain });
  if (f.createdRange) {
    const cutoff = Date.now() - RANGE_DAYS[f.createdRange] * 24 * 60 * 60 * 1000;
    filters.push({ propertyName: "createdate", operator: "GTE", value: String(cutoff) });
  }

  // Industries / countries / lifecycles : OR via plusieurs filterGroups
  const groups: Array<{ filters: Array<{ propertyName: string; operator: string; value?: string }> }> = [];
  const multiAxis: Array<{ key: keyof Filters; prop: string }> = [
    { key: "industry", prop: "industry" },
    { key: "country", prop: "country" },
    { key: "lifecyclestage", prop: "lifecyclestage" },
  ];
  const expandedGroups: Array<Array<{ propertyName: string; operator: string; value?: string }>> = [[...filters]];
  for (const { key, prop } of multiAxis) {
    const vals = (f[key] as string[] | undefined)?.filter(Boolean) ?? [];
    if (vals.length === 0) continue;
    const next: typeof expandedGroups = [];
    for (const base of expandedGroups) {
      for (const v of vals) {
        next.push([...base, { propertyName: prop, operator: "EQ", value: v }]);
      }
    }
    expandedGroups.length = 0;
    expandedGroups.push(...next);
  }
  // On n'émet que les groupes ayant au moins un filtre. Si aucun filtre n'est
  // posé, on renvoie [] => la recherche HubSpot tourne sans filterGroups et
  // liste toutes les companies (triées), au lieu de renvoyer 0 résultat sur un
  // groupe vide.
  for (const g of expandedGroups) if (g.length > 0) groups.push({ filters: g });
  return groups;
}

type SearchResponse = {
  results?: HubspotCompanyRow[];
  paging?: { next?: { after?: string } };
};

/** Une page de résultats HubSpot (max 100) + le curseur pour la suivante. */
async function searchHubspotCompaniesPage(
  filters: Filters,
  after: string | undefined,
  limit: number,
): Promise<{ rows: HubspotCompanyRow[]; nextAfter: string | null }> {
  let filterGroups = buildFilterGroups(filters);
  // HubSpot /search ne renvoie rien sans aucun critère. Si ni filtre ni requête
  // ne sont fournis (chargement initial "toutes les companies"), on injecte un
  // catch-all `name HAS_PROPERTY` : liste toutes les companies AYANT un nom
  // (le tri par nom ASC ferait sinon remonter en premier les companies sans nom,
  // qui sont ensuite filtrées => 0 résultat affiché).
  if (filterGroups.length === 0 && !filters.q) {
    filterGroups = [{ filters: [{ propertyName: "name", operator: "HAS_PROPERTY" }] }];
  }
  const sorts = filters.sort === "created-desc"
    ? [{ propertyName: "createdate", direction: "DESCENDING" as const }]
    : [{ propertyName: "name", direction: "ASCENDING" as const }];
  const page = await hubspotFetch<SearchResponse>("/crm/v3/objects/companies/search", "POST", {
    properties: COMPANY_PROPS,
    ...(filterGroups.length > 0 ? { filterGroups } : {}),
    ...(filters.q ? { query: filters.q } : {}),
    sorts,
    limit,
    ...(after ? { after } : {}),
  });
  return { rows: page.results ?? [], nextAfter: page.paging?.next?.after ?? null };
}

/** Lit les companies sélectionnées par id (batch read), pour le commit. */
async function fetchCompaniesByIds(ids: string[]): Promise<HubspotCompanyRow[]> {
  const out: HubspotCompanyRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await hubspotFetch<{ results?: HubspotCompanyRow[] }>(
      "/crm/v3/objects/companies/batch/read",
      "POST",
      { properties: COMPANY_PROPS, inputs: chunk.map((id) => ({ id })) },
    );
    out.push(...(res.results ?? []));
  }
  return out;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!process.env.HUBSPOT_ACCESS_TOKEN)
    return NextResponse.json({ error: "HubSpot non configuré" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as {
    filters?: Filters;
    defaultOwner?: string;
    dryRun?: boolean;
    selectedIds?: string[];
    mode?: "skip" | "update";
    after?: string;
    pageSize?: number;
  } | null;
  if (!body) return NextResponse.json({ error: "Body invalide" }, { status: 400 });

  const filters = body.filters ?? {};
  const dryRun = body.dryRun !== false && !body.selectedIds; // dryRun par défaut si pas de selection
  const mode: "skip" | "update" = body.mode === "update" ? "update" : "skip";

  try {
    // Companies déjà dans la scope (dedup case-insensitive sur name).
    const { data: existing } = await db.from("scope_companies").select("id, name");
    const existingNames = new Set((existing ?? []).map((r) => (r.name as string).toLowerCase()));

    const toPreview = (rows: HubspotCompanyRow[]): PreviewCompany[] =>
      rows
        .map((r) => {
          const name = (r.properties.name ?? "").trim();
          if (!name) return null;
          return {
            hubspotId: r.id,
            name,
            industry: r.properties.industry?.trim() || null,
            country: r.properties.country?.trim() || null,
            employees: toInt(r.properties.numberofemployees),
            domain: r.properties.domain?.trim() || null,
            lifecyclestage: r.properties.lifecyclestage?.trim() || null,
            ownerId: r.properties.hubspot_owner_id?.trim() || null,
            createdAt: r.properties.createdate?.trim() || null,
            alreadyInScope: existingNames.has(name.toLowerCase()),
          };
        })
        .filter((p): p is PreviewCompany => p !== null);

    if (dryRun) {
      const pageSize = Math.min(Math.max(body.pageSize ?? 50, 1), 100);
      const { rows, nextAfter } = await searchHubspotCompaniesPage(filters, body.after, pageSize);
      const preview = toPreview(rows);
      return NextResponse.json({
        dryRun: true,
        preview,
        total: preview.length,
        nextAfter, // null = plus de page
      });
    }

    // ── Commit : on lit les companies sélectionnées par id.
    const defaultOwner = (body.defaultOwner ?? "").trim();
    if (!defaultOwner) {
      return NextResponse.json({ error: "Owner par défaut obligatoire" }, { status: 400 });
    }
    const selectedIds = (body.selectedIds ?? []).filter(Boolean);
    if (selectedIds.length === 0) {
      return NextResponse.json({ error: "Aucune company sélectionnée" }, { status: 400 });
    }
    const toImport = toPreview(await fetchCompaniesByIds(selectedIds));
    if (toImport.length === 0) {
      return NextResponse.json({ error: "Aucune company sélectionnée" }, { status: 400 });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { name: string; reason: string }[] = [];

    const existingByLower = new Map<string, string>();
    for (const r of existing ?? [])
      existingByLower.set((r.name as string).toLowerCase(), r.id as string);

    for (const c of toImport) {
      const lower = c.name.toLowerCase();
      const existingId = existingByLower.get(lower);
      // La company vient de HubSpot : on persiste directement le lien
      // (hubspot_company_id) pour relier contacts/emails sans fuzzy match.
      const payload = {
        name: c.name,
        owner: defaultOwner,
        sector: c.industry,
        hubspot_company_id: c.hubspotId,
        hubspot_resolved_at: new Date().toISOString(),
      };
      if (existingId) {
        if (mode === "skip") {
          skipped++;
          continue;
        }
        const { error } = await db
          .from("scope_companies")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existingId);
        if (error) errors.push({ name: c.name, reason: error.message });
        else updated++;
      } else {
        const { error } = await db.from("scope_companies").insert(payload);
        if (error) {
          if (error.code === "23505") skipped++;
          else errors.push({ name: c.name, reason: error.message });
        } else {
          inserted++;
        }
      }
    }

    await maybeCreateSalesRep(defaultOwner);

    return NextResponse.json({
      ok: true,
      summary: { inserted, updated, skipped, errors, total: toImport.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur HubSpot" },
      { status: 500 }
    );
  }
}
