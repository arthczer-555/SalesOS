// Recherche / création de contact HubSpot partagée (Prospecting, et à terme
// les autres flux qui créent des contacts : push de liste, Signals, Apollo,
// orgchart, finalize de leads, qui gardent leur copie pour l'instant).
//
// Contrairement à findContactByEmail (lib/intel/hubspot-company-resolve.ts),
// la recherche ici LÈVE en cas d'erreur HubSpot : une recherche en échec ne
// doit jamais être prise pour "contact absent", sinon on crée un doublon. En
// dernier filet, un 409 "Contact already exists. Existing ID: N" est rattrapé.
import { hubspotAssociate, hubspotFetch, hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "./hubspot";
import { findCompanyByDomain } from "./intel/hubspot-company-resolve";

export interface HubspotContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  phone?: string | null;
  /** Owner HubSpot du contact créé (users.hubspot_owner_id du rep). */
  ownerId?: string | null;
  /** Domaine d'entreprise pour rattacher le contact créé à une company existante. */
  companyDomain?: string | null;
  /** Company HubSpot déjà connue (prioritaire sur la recherche par domaine). */
  companyId?: string | null;
  /** Lifecycle stage à la création (défaut "lead", null pour ne rien poser). */
  lifecyclestage?: string | null;
}

export interface HubspotContactResult {
  id: string;
  created: boolean;
  /** Company associée à la création (null si aucune ou contact existant). */
  companyId: string | null;
}

/** Id du contact HubSpot pour cet email, null s'il n'existe pas. Lève si HubSpot échoue. */
export async function findHubspotContactIdByEmail(email: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "contacts",
    {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.trim().toLowerCase() }] }],
      properties: ["email"],
      limit: 1,
    },
    1,
  );
  return rows[0]?.id ?? null;
}

function existingIdFromConflict(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("409")) return null;
  const m = /Existing ID:\s*(\d+)/i.exec(msg);
  return m ? m[1] : null;
}

/** Contact HubSpot existant (par email) ou créé, rattaché à sa company si on la trouve. */
export async function findOrCreateHubspotContact(input: HubspotContactInput): Promise<HubspotContactResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("Email required to create a HubSpot contact");

  const existing = await findHubspotContactIdByEmail(email);
  if (existing) return { id: existing, created: false, companyId: null };

  const properties: Record<string, string> = { email };
  const set = (key: string, v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (t) properties[key] = t;
  };
  set("firstname", input.firstName);
  set("lastname", input.lastName);
  set("jobtitle", input.jobTitle);
  set("company", input.company);
  set("phone", input.phone);
  set("hubspot_owner_id", input.ownerId);
  const stage = input.lifecyclestage === undefined ? "lead" : input.lifecyclestage;
  if (stage) properties.lifecyclestage = stage;

  let id: string;
  try {
    const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", "POST", { properties });
    id = String(res.id);
  } catch (e) {
    const conflictId = existingIdFromConflict(e);
    if (!conflictId) throw e;
    return { id: conflictId, created: false, companyId: null };
  }

  // Rattachement à la company : best-effort, n'annule jamais la création.
  let companyId = input.companyId ?? null;
  try {
    const domain = (input.companyDomain ?? "").trim().toLowerCase();
    if (!companyId && domain && !PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(domain)) companyId = await findCompanyByDomain(domain);
    if (companyId) await hubspotAssociate("contacts", id, "companies", companyId);
  } catch (e) {
    console.error("[hubspot-contacts] company association failed:", e instanceof Error ? e.message : e);
    companyId = null;
  }
  return { id, created: true, companyId };
}
