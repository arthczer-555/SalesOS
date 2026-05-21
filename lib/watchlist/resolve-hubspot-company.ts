import { db } from "@/lib/db";
import { hubspotSearchAll } from "@/lib/hubspot";
import { normalizeCompany, pickBestFuzzy } from "@/lib/fuzzy-match";

interface HubspotCompanyResult {
  id: string;
  properties: {
    name?: string;
    domain?: string;
  };
}

export interface ResolvedHubspotCompany {
  hubspot_company_id: string | null;
  /** Score Jaro-Winkler du best match (0 si pas de match) */
  match_score: number;
  /** True si on a hit le cache `scope_companies.hubspot_company_id` */
  from_cache: boolean;
}

const FUZZY_THRESHOLD = 0.85;

/**
 * Résout le HubSpot Company id correspondant à une row scope_companies.
 *
 * 1. Lit `scope_companies.hubspot_company_id` (cache).
 * 2. Sinon : recherche HubSpot par tokens du nom (CONTAINS_TOKEN, top 5).
 * 3. Fuzzy match (Jaro-Winkler) entre nom et résultats. Seuil >= 0.85 → auto-link.
 *
 * Sur succès, persiste le lien sur `scope_companies` pour éviter de
 * réinterroger HubSpot à chaque refresh.
 */
export async function resolveHubspotCompanyId(
  scopeCompanyId: string,
): Promise<ResolvedHubspotCompany> {
  const { data: scope, error: scopeErr } = await db
    .from("scope_companies")
    .select("id, name, hubspot_company_id, hubspot_resolved_at")
    .eq("id", scopeCompanyId)
    .single();

  if (scopeErr || !scope) {
    throw new Error(`scope_companies row not found: ${scopeCompanyId}`);
  }

  if (scope.hubspot_company_id) {
    return { hubspot_company_id: scope.hubspot_company_id, match_score: 1, from_cache: true };
  }

  const tokens = normalizeCompany(scope.name)
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  if (tokens.length === 0) {
    return { hubspot_company_id: null, match_score: 0, from_cache: false };
  }

  // CONTAINS_TOKEN sur le premier token significatif (le plus discriminant).
  // En multi-tokens (ex. "Crédit Agricole"), on prend le plus long pour
  // maximiser la spécificité.
  const filterToken = [...tokens].sort((a, b) => b.length - a.length)[0];

  let candidates: HubspotCompanyResult[] = [];
  try {
    candidates = await hubspotSearchAll<HubspotCompanyResult>(
      "companies",
      {
        properties: ["name", "domain"],
        filterGroups: [
          {
            filters: [
              { propertyName: "name", operator: "CONTAINS_TOKEN", value: filterToken },
            ],
          },
        ],
        limit: 10,
      },
      10,
    );
  } catch (e) {
    console.error("[resolveHubspotCompanyId] HubSpot search failed:", e);
    return { hubspot_company_id: null, match_score: 0, from_cache: false };
  }

  if (candidates.length === 0) {
    return { hubspot_company_id: null, match_score: 0, from_cache: false };
  }

  const needle = normalizeCompany(scope.name);
  const best = pickBestFuzzy(
    candidates,
    needle,
    (c) => normalizeCompany(c.properties?.name ?? ""),
    FUZZY_THRESHOLD,
  );

  if (!best) {
    return { hubspot_company_id: null, match_score: 0, from_cache: false };
  }

  // Persiste sur scope_companies pour les prochaines fois
  await db
    .from("scope_companies")
    .update({
      hubspot_company_id: best.item.id,
      hubspot_resolved_at: new Date().toISOString(),
    })
    .eq("id", scopeCompanyId);

  return { hubspot_company_id: best.item.id, match_score: best.score, from_cache: false };
}
