import { extractTitleSearchHint } from "../claap";
import { hubspotFetch, type DealSnapshot } from "../hubspot";
import { DEAL_NAME_NOISE_TOKENS, GENERIC_NAME_TOKENS, isExcludedEmailDomain, tokenizeWords } from "./claap-discovery";
import type { AccountCompany, AccountCompanyReason } from "./types";

// Détection, au refresh, des companies HubSpot qui appartiennent au même compte
// que la company du deal. Un client est souvent éclaté sur plusieurs companies :
// doublon sans nom créé par le domaine email des contacts (Messika /
// messikagroup.com), plusieurs companies sur le même domaine (ENGIE, ENGIE
// Impact), filiales (VINCI Construction) ou entité du groupe (Groupe Engie).
//
// Trois signaux, du plus sûr au moins sûr :
//  1. même domaine web que la company du deal ;
//  2. domaine email porté par au moins la moitié des contacts du compte. Un
//     domaine minoritaire ne compte pas : une contact Opella encore en
//     @sanofi.com ne doit pas faire entrer Sanofi ;
//  3. nom qui contient TOUS les mots distinctifs du nom du compte, en mot entier
//     ("ENGIE Impact", "Groupe Engie" pour ENGIE ; pas "Allianz Partners" pour
//     Allianz Trade).
// Seules les companies actives sur RECENT_DAYS sont retenues (une company sans
// activité n'apporte rien et encombrerait le panneau). Le résultat est ajouté au
// compte en "pending" : un humain confirme ou retire depuis la fiche, un retrait
// est définitif (declined_company_ids).

const RECENT_DAYS = 180;
const MAX_NEW_PER_REFRESH = 5;
const COMPANY_PROPS = ["name", "domain", "notes_last_updated"];

type CompanyRow = { id: string; properties: Record<string, string | null | undefined> };

function normalizeDomain(d: string | null | undefined): string | null {
  const v = d?.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return v || null;
}

// Mots distinctifs du nom du compte. Les mots de 2 lettres comptent ("DP World"
// exige "dp" ET "world"), mais il en faut au moins un de 3 lettres ou plus,
// sinon pas de recherche par nom.
export function accountNameTokens(deal: DealSnapshot): string[] {
  const pick = (raw: string, blocklist: Set<string>) =>
    [...new Set(tokenizeWords(raw).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !blocklist.has(w)))];
  let tokens = deal.company?.name ? pick(deal.company.name, GENERIC_NAME_TOKENS) : [];
  if (tokens.length === 0) {
    const hint = extractTitleSearchHint(deal.name, "anything@coachello.io") ?? deal.name;
    tokens = pick(hint, DEAL_NAME_NOISE_TOKENS);
  }
  return tokens.some((t) => t.length >= 3) ? tokens : [];
}

// Domaines email portés par au moins la moitié des contacts à adresse pro.
function majorityContactDomains(deal: DealSnapshot): string[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of deal.contacts) {
    const dom = normalizeDomain(c.email?.split("@")[1]);
    if (!dom || isExcludedEmailDomain(dom)) continue;
    total++;
    counts.set(dom, (counts.get(dom) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n * 2 >= total).map(([d]) => d);
}

async function searchCompanies(body: Record<string, unknown>): Promise<CompanyRow[]> {
  const res = await hubspotFetch<{ results?: CompanyRow[] }>("/crm/v3/objects/companies/search", "POST", {
    properties: COMPANY_PROPS,
    limit: 100,
    ...body,
  });
  return res.results ?? [];
}

export async function discoverAccountCompanies(
  deal: DealSnapshot,
  knownIds: Set<string>,
): Promise<{ companies: AccountCompany[]; error: string | null }> {
  try {
    const accountName = deal.company?.name || deal.name;
    const companyDomain = normalizeDomain(deal.company?.domain);
    const contactDomains = majorityContactDomains(deal).filter((d) => d !== companyDomain);
    const domains = [...new Set([...(companyDomain ? [companyDomain] : []), ...contactDomains])];
    const tokens = accountNameTokens(deal);

    const found = new Map<string, { row: CompanyRow; reason: AccountCompanyReason; detail: string }>();
    const keep = (row: CompanyRow, reason: AccountCompanyReason, detail: string) => {
      if (!knownIds.has(row.id) && !found.has(row.id)) found.set(row.id, { row, reason, detail });
    };

    if (domains.length > 0) {
      const rows = await searchCompanies({
        filterGroups: [{ filters: [{ propertyName: "domain", operator: "IN", values: domains.flatMap((d) => [d, `www.${d}`]) }] }],
      });
      for (const row of rows) {
        const dom = normalizeDomain(row.properties.domain);
        if (dom && dom === companyDomain) keep(row, "same_domain", `Same website domain as ${accountName} (${dom})`);
      }
      for (const row of rows) {
        const dom = normalizeDomain(row.properties.domain);
        if (dom && contactDomains.includes(dom)) keep(row, "contact_domain", `Email domain of this account's contacts (${dom})`);
      }
    }

    if (tokens.length > 0) {
      const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
      for (const row of await searchCompanies({ query: longest })) {
        const words = new Set(tokenizeWords(row.properties.name ?? ""));
        if (tokens.every((t) => words.has(t))) keep(row, "name", `Name matches the account (${accountName})`);
      }
    }

    const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const order: Record<AccountCompanyReason, number> = { merged: 0, same_domain: 0, contact_domain: 1, name: 2 };
    const now = new Date().toISOString();
    const companies = [...found.values()]
      .map(({ row, reason, detail }) => ({ row, reason, detail, last: Date.parse(row.properties.notes_last_updated ?? "") || 0 }))
      .filter((c) => c.last >= since)
      .sort((a, b) => order[a.reason] - order[b.reason] || b.last - a.last)
      .slice(0, MAX_NEW_PER_REFRESH)
      .map(({ row, reason, detail, last }): AccountCompany => ({
        id: row.id,
        name: row.properties.name?.trim() || null,
        domain: normalizeDomain(row.properties.domain),
        reason,
        detail,
        status: "pending",
        added_at: now,
        last_activity_at: new Date(last).toISOString(),
      }));
    return { companies, error: null };
  } catch (e) {
    return { companies: [], error: e instanceof Error ? e.message : String(e) };
  }
}
