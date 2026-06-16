// Récupère les contacts d'une company HubSpot pour l'import d'un compte orgchart.
// Calqué sur lib/watchlist/fetch-company-contacts.ts (associations + batch read),
// mais résout la company par NOM et renvoie plus de champs.
import { hubspotFetch, hubspotGetAssociations, hubspotSearchAll } from "@/lib/hubspot";
import { findCompanyByName, findCompanyByDomain } from "@/lib/intel/hubspot-company-resolve";
import type { HubspotCompanyHit } from "./types";

export interface HubspotOrgContact {
  hubspot_contact_id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  hubspot_owner_id: string | null;
}

const CONTACT_CAP = 150;

export interface FetchedCompany {
  hubspot_company_id: string | null;
  resolved_name: string | null;
  domain: string | null;
  contacts: HubspotOrgContact[];
}

export async function fetchHubspotCompanyContacts(
  companyName: string,
  opts?: { domain?: string | null },
): Promise<FetchedCompany> {
  let companyId: string | null = null;
  let resolvedName: string | null = null;
  let domain = opts?.domain ?? null;

  if (domain) companyId = await findCompanyByDomain(domain).catch(() => null);
  if (!companyId) {
    const hit = await findCompanyByName(companyName).catch(() => null);
    if (hit) {
      companyId = hit.id;
      resolvedName = hit.name;
    }
  }
  if (!companyId) return { hubspot_company_id: null, resolved_name: null, domain, contacts: [] };

  // Récupère le domaine de la company (pour Apollo plus tard).
  if (!domain) {
    try {
      const comp = await hubspotFetch<{ properties?: { name?: string; domain?: string } }>(
        `/crm/v3/objects/companies/${companyId}?properties=name,domain`,
      );
      domain = comp.properties?.domain ?? null;
      resolvedName = resolvedName ?? comp.properties?.name ?? null;
    } catch {
      /* ignore */
    }
  }

  const assoc = await hubspotGetAssociations("companies", companyId, "contacts");
  const ids = assoc.map((a) => a.id).slice(0, CONTACT_CAP);
  if (ids.length === 0) return { hubspot_company_id: companyId, resolved_name: resolvedName, domain, contacts: [] };

  let contacts: HubspotOrgContact[] = [];
  try {
    const res = await hubspotFetch<{ results?: Array<{ id: string; properties?: Record<string, string> }> }>(
      "/crm/v3/objects/contacts/batch/read",
      "POST",
      {
        properties: ["firstname", "lastname", "jobtitle", "email", "hs_linkedin_url", "hubspot_owner_id"],
        inputs: ids.map((id) => ({ id })),
      },
    );
    contacts = (res.results ?? []).map((r) => {
      const p = r.properties ?? {};
      const name = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() || (p.email ?? "Unnamed");
      return {
        hubspot_contact_id: r.id,
        name,
        title: p.jobtitle || null,
        email: p.email || null,
        linkedin_url: p.hs_linkedin_url || null,
        hubspot_owner_id: p.hubspot_owner_id || null,
      };
    });
  } catch (e) {
    console.error("[orgchart hubspot fetch] batch read failed:", e instanceof Error ? e.message : e);
  }

  return { hubspot_company_id: companyId, resolved_name: resolvedName, domain, contacts };
}

// Recherche multi-résultats de company HubSpot par nom (pour la modale "New
// account" : un compte peut regrouper plusieurs company, ex. Allianz Trade +
// Partners + Technology). Renvoie jusqu'à 25 company.
export async function searchHubspotCompanies(query: string): Promise<HubspotCompanyHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const filterToken = [...tokens].sort((a, b) => b.length - a.length)[0] ?? q;
  try {
    const rows = await hubspotSearchAll<{ id: string; properties?: { name?: string; domain?: string } }>(
      "companies",
      {
        properties: ["name", "domain"],
        filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: filterToken }] }],
        limit: 25,
        sorts: [{ propertyName: "name", direction: "ASCENDING" }],
      },
      25,
    );
    return rows
      .map((r) => ({ id: r.id, name: r.properties?.name ?? "(no name)", domain: r.properties?.domain ?? null }))
      .filter((c) => c.name);
  } catch (e) {
    console.error("[orgchart] company search failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// Récupère les contacts associés à une company HubSpot DONNÉE (par id), avec son
// nom/domaine. Utilisé par l'import multi-company.
export async function fetchContactsForCompany(
  companyId: string,
): Promise<{ id: string; name: string | null; domain: string | null; contacts: HubspotOrgContact[] }> {
  let name: string | null = null;
  let domain: string | null = null;
  try {
    const comp = await hubspotFetch<{ properties?: { name?: string; domain?: string } }>(
      `/crm/v3/objects/companies/${companyId}?properties=name,domain`,
    );
    name = comp.properties?.name ?? null;
    domain = comp.properties?.domain ?? null;
  } catch {
    /* ignore */
  }

  const assoc = await hubspotGetAssociations("companies", companyId, "contacts");
  const ids = assoc.map((a) => a.id).slice(0, CONTACT_CAP);
  if (ids.length === 0) return { id: companyId, name, domain, contacts: [] };

  let contacts: HubspotOrgContact[] = [];
  try {
    const res = await hubspotFetch<{ results?: Array<{ id: string; properties?: Record<string, string> }> }>(
      "/crm/v3/objects/contacts/batch/read",
      "POST",
      {
        properties: ["firstname", "lastname", "jobtitle", "email", "hs_linkedin_url", "hubspot_owner_id"],
        inputs: ids.map((id) => ({ id })),
      },
    );
    contacts = (res.results ?? []).map((r) => {
      const p = r.properties ?? {};
      const nm = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() || (p.email ?? "Unnamed");
      return {
        hubspot_contact_id: r.id,
        name: nm,
        title: p.jobtitle || null,
        email: p.email || null,
        linkedin_url: p.hs_linkedin_url || null,
        hubspot_owner_id: p.hubspot_owner_id || null,
      };
    });
  } catch (e) {
    console.error("[orgchart] fetchContactsForCompany batch read failed:", e instanceof Error ? e.message : e);
  }
  return { id: companyId, name, domain, contacts };
}
