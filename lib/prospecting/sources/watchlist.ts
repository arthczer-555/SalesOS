// Source "Watch List" : comptes suivis (scope_companies) et leurs contacts
// HubSpot. Contrairement à fetchCompanyContacts (fiche watchlist), une erreur
// HubSpot remonte ici au lieu de produire une liste vide indistinguable d'un
// compte sans contact.
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";
import { normDomain } from "../store/util";
import type { WatchAccountItem, WatchContactItem, WatchContactsResponse } from "./shared";

const CONTACT_CAP = 100;

interface ScopeRow {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  hubspot_company_id: string | null;
}

export async function searchWatchAccounts(q: string): Promise<WatchAccountItem[]> {
  let query = db.from("scope_companies").select("id, name, owner, sector, hubspot_company_id").order("name", { ascending: true }).limit(60);
  const term = q.trim().replace(/[%_,()]/g, " ").trim();
  if (term) query = query.ilike("name", `%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ScopeRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner,
    sector: r.sector,
    hubspotCompanyId: r.hubspot_company_id,
  }));
}

/** Contacts HubSpot d'un compte Watch List, mappés en prospects (source "watchlist"). */
export async function getWatchAccountContacts(scopeCompanyId: string): Promise<WatchContactsResponse | null> {
  const { data: scope } = await db.from("scope_companies").select("id, name").eq("id", scopeCompanyId).maybeSingle();
  if (!scope) return null;
  const account = scope as { id: string; name: string };

  const resolved = await resolveHubspotCompanyId(scopeCompanyId);
  const hubspotCompanyId = resolved.hubspot_company_id;
  if (!hubspotCompanyId) {
    return { account: { id: account.id, name: account.name, domain: null, hubspotCompanyId: null }, contacts: [] };
  }

  // Domaine de l'entreprise HubSpot : sert au bouton "Find people here with Apollo".
  let domain: string | null = null;
  try {
    const company = await hubspotFetch<{ properties?: Record<string, string | null> }>(
      `/crm/v3/objects/companies/${hubspotCompanyId}?properties=domain,website`,
    );
    domain = normDomain(company.properties?.domain ?? company.properties?.website ?? null);
  } catch {
    domain = null;
  }

  // Appel direct (hubspotGetAssociations avale les erreurs et renverrait []).
  const assoc = await hubspotFetch<{ results?: { toObjectId?: string | number; id?: string | number }[] }>(
    `/crm/v4/objects/companies/${hubspotCompanyId}/associations/contacts?limit=500`,
  );
  const ids = (assoc.results ?? [])
    .map((r) => String(r.toObjectId ?? r.id ?? ""))
    .filter(Boolean)
    .slice(0, CONTACT_CAP);
  let contacts: WatchContactItem[] = [];
  if (ids.length) {
    const res = await hubspotFetch<{ results?: { id: string; properties?: Record<string, string | null> }[] }>(
      "/crm/v3/objects/contacts/batch/read",
      "POST",
      {
        properties: ["firstname", "lastname", "email", "jobtitle", "phone", "mobilephone", "linkedin_url", "lastmodifieddate", "city", "country"],
        inputs: ids.map((id) => ({ id })),
      },
    );
    contacts = (res.results ?? []).map((r) => {
      const p = r.properties ?? {};
      return {
        lead: {
          firstName: (p.firstname ?? "").trim(),
          lastName: (p.lastname ?? "").trim(),
          email: p.email || null,
          title: p.jobtitle || null,
          phone: p.mobilephone || p.phone || null,
          companyName: account.name,
          companyDomain: domain,
          linkedinUrl: p.linkedin_url || null,
          location: [p.city, p.country].filter(Boolean).join(", ") || null,
          country: p.country || null,
          hubspotContactId: r.id,
          hubspotCompanyId,
          scopeCompanyId: account.id,
          source: "watchlist" as const,
        },
        lastActivity: p.lastmodifieddate || null,
      };
    });
    contacts.sort((a, b) => (b.lastActivity ? Date.parse(b.lastActivity) : 0) - (a.lastActivity ? Date.parse(a.lastActivity) : 0));
  }

  return { account: { id: account.id, name: account.name, domain, hubspotCompanyId }, contacts };
}
