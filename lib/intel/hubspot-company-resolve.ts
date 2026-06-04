// Résolution de contacts/companies HubSpot, partagée entre le push de liste
// (push-list-to-hubspot.ts) et la preview de l'enrich
// (app/api/intel/admin/scope-companies/resolve-hubspot). Extrait verbatim de
// push-list-to-hubspot.ts pour éviter une double implémentation.
import { hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "../hubspot";
import { normalizeCompany, pickBestFuzzy } from "../fuzzy-match";

export const COMPANY_FUZZY_THRESHOLD = 0.85;

export function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Domaine d'entreprise exploitable (ni vide ni grand public) inféré d'un email. */
export function businessDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const dom = domainFromEmail(email.trim());
  if (!dom) return null;
  if (PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(dom)) return null;
  return dom;
}

export async function findContactByEmail(email: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "contacts",
    {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] }],
      properties: ["email"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

export async function findCompanyByDomain(domain: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "companies",
    {
      filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }],
      properties: ["domain"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

// Match flou par nom (même approche que resolveHubspotCompanyId) : CONTAINS_TOKEN
// sur le token le plus discriminant, puis Jaro-Winkler >= seuil. Renvoie
// { id, name } d'une company EXISTANTE ou null (aucune création).
export async function findCompanyByName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const needle = normalizeCompany(name);
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const filterToken = [...tokens].sort((a, b) => b.length - a.length)[0];

  let candidates: Array<{ id: string; properties?: { name?: string } }> = [];
  try {
    candidates = await hubspotSearchAll<{ id: string; properties?: { name?: string } }>(
      "companies",
      {
        properties: ["name"],
        filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: filterToken }] }],
        limit: 10,
      },
      10,
    );
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  const best = pickBestFuzzy(
    candidates,
    needle,
    (c) => normalizeCompany(c.properties?.name ?? ""),
    COMPANY_FUZZY_THRESHOLD,
  );
  if (!best) return null;
  return { id: best.item.id, name: best.item.properties?.name ?? name };
}
