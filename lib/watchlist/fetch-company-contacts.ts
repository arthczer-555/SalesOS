import { hubspotFetch, hubspotGetAssociations } from "@/lib/hubspot";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";

export interface CompanyContact {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  jobtitle: string | null;
  /** Numéro révélé / connu (mobilephone en priorité, sinon phone). */
  phone: string | null;
  last_activity: string | null;
}

const CONTACT_CAP = 50;

/**
 * Liste les contacts HubSpot associés à une scope_company (pour affichage sur
 * la fiche). Résout d'abord le hubspot_company_id (cache scope_companies, sinon
 * fuzzy match). Renvoie un tableau vide si pas de company HubSpot liée.
 */
export async function fetchCompanyContacts(
  scopeCompanyId: string,
): Promise<{ hubspot_company_id: string | null; contacts: CompanyContact[] }> {
  const resolved = await resolveHubspotCompanyId(scopeCompanyId);
  const hubspotCompanyId = resolved.hubspot_company_id;
  if (!hubspotCompanyId) return { hubspot_company_id: null, contacts: [] };

  const assoc = await hubspotGetAssociations("companies", hubspotCompanyId, "contacts");
  const ids = assoc.map((a) => a.id).slice(0, CONTACT_CAP);
  if (ids.length === 0) return { hubspot_company_id: hubspotCompanyId, contacts: [] };

  let contacts: CompanyContact[] = [];
  try {
    const res = await hubspotFetch<{ results?: Array<{ id: string; properties?: Record<string, string> }> }>(
      "/crm/v3/objects/contacts/batch/read",
      "POST",
      {
        properties: ["firstname", "lastname", "email", "jobtitle", "phone", "mobilephone", "lastmodifieddate"],
        inputs: ids.map((id) => ({ id })),
      },
    );
    contacts = (res.results ?? []).map((r) => {
      const p = r.properties ?? {};
      return {
        id: r.id,
        firstname: p.firstname || null,
        lastname: p.lastname || null,
        email: p.email || null,
        jobtitle: p.jobtitle || null,
        phone: p.mobilephone || p.phone || null,
        last_activity: p.lastmodifieddate || null,
      };
    });
  } catch (e) {
    console.error("[fetchCompanyContacts] batch read failed:", e instanceof Error ? e.message : e);
    return { hubspot_company_id: hubspotCompanyId, contacts: [] };
  }

  // Plus récemment actifs en premier.
  contacts.sort((a, b) => {
    const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return tb - ta;
  });

  return { hubspot_company_id: hubspotCompanyId, contacts };
}
