// Lie une SEULE personne à HubSpot (find-or-create contact + association à la
// company du compte + write-back des liens). Aucun reveal d'email (donc aucun
// crédit Apollo, et conforme à la règle "jamais reveal un contact déjà sur
// HubSpot"). Best-effort : ne throw jamais (la personne existe déjà en base).
import { db } from "@/lib/db";
import { hubspotFetch, hubspotAssociate, createCompany, hubspotGetAssociations } from "@/lib/hubspot";
import { findContactByEmail, findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { normalizePerson } from "@/lib/fuzzy-match";
import { getAccount, getPerson, listAccountCompanies } from "./db";
import type { OrgPerson } from "./types";

function splitName(full: string): { firstname: string; lastname: string } {
  const t = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { firstname: "", lastname: "" };
  if (t.length === 1) return { firstname: t[0], lastname: "" };
  return { firstname: t[0], lastname: t.slice(1).join(" ") };
}

function usableEmail(email: string | null): string | null {
  return email && email.includes("@") && !/email_not_unlocked@/i.test(email) ? email : null;
}

async function createContact(p: OrgPerson, email: string | null, ownerId: string | null): Promise<string> {
  const { firstname, lastname } = splitName(p.name);
  const props: Record<string, string> = { lifecyclestage: "lead" };
  if (email) props.email = email.toLowerCase();
  if (firstname) props.firstname = firstname;
  if (lastname) props.lastname = lastname;
  const title = p.title || p.title_hubspot;
  if (title) props.jobtitle = title;
  // NE PAS poser props.company : si HubSpot "créer+associer auto" est actif, ça
  // crée un doublon de company sans owner. L'association explicite via
  // hubspotAssociate (appelée juste après) suffit. cf. B8.
  if (ownerId) props.hubspot_owner_id = ownerId;
  const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", "POST", { properties: props });
  return res.id;
}

async function matchByNameInCompany(companyId: string, name: string): Promise<string | null> {
  try {
    const assoc = await hubspotGetAssociations("companies", companyId, "contacts");
    const ids = assoc.map((a) => a.id).slice(0, 200);
    if (ids.length === 0) return null;
    const res = await hubspotFetch<{ results?: Array<{ id: string; properties?: Record<string, string> }> }>(
      "/crm/v3/objects/contacts/batch/read",
      "POST",
      { properties: ["firstname", "lastname"], inputs: ids.map((id) => ({ id })) },
    );
    const target = normalizePerson(name);
    for (const r of res.results ?? []) {
      const n = `${r.properties?.firstname ?? ""} ${r.properties?.lastname ?? ""}`.trim();
      if (normalizePerson(n) === target) return r.id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Cherche (SANS créer) un contact HubSpot déjà existant pour cette personne :
// par email connu, sinon par nom parmi les contacts de la company. Sert au
// pré-check "ne jamais reveal quelqu'un déjà sur HubSpot".
export async function findExistingHubspotContact(
  person: Pick<OrgPerson, "email" | "name">,
  companyId: string,
): Promise<string | null> {
  const email = usableEmail(person.email);
  if (email) {
    const c = await findContactByEmail(email).catch(() => null);
    if (c) return c;
  }
  return matchByNameInCompany(companyId, person.name);
}

export async function linkPersonToHubspot(personId: string, accountId: string, ownerId: string | null): Promise<void> {
  try {
    const person = await getPerson(personId);
    if (!person) return;
    const account = await getAccount(accountId);
    if (!account) return;

    // Company cible.
    const companies = await listAccountCompanies(accountId).catch(() => []);
    let companyId = person.hubspot_company_id || account.hubspot_company_id || companies[0]?.hubspot_company_id || null;
    if (!companyId) {
      const hit = await findCompanyByName(account.name).catch(() => null);
      companyId = hit?.id ?? (await createCompany(account.name, account.domain).catch(() => null));
      if (companyId) await db.from("orgchart_accounts").update({ hubspot_company_id: companyId }).eq("id", accountId);
    }
    if (!companyId) return;

    // Déjà lié -> on s'assure juste de l'association.
    if (person.hubspot_contact_id) {
      await hubspotAssociate("contacts", person.hubspot_contact_id, "companies", companyId).catch(() => {});
      return;
    }

    // Find-or-create SANS reveal.
    const email = usableEmail(person.email);
    let contactId: string | null = null;
    if (email) contactId = await findContactByEmail(email).catch(() => null);
    if (!contactId) contactId = await matchByNameInCompany(companyId, person.name);
    if (!contactId) contactId = await createContact(person, email, ownerId);

    await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => {});
    await db
      .from("orgchart_people")
      .update({
        hubspot_contact_id: contactId,
        in_hubspot: true,
        hubspot_company_id: companyId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", personId);
  } catch (e) {
    console.warn("[orgchart] linkPersonToHubspot failed:", e instanceof Error ? e.message : e);
  }
}
