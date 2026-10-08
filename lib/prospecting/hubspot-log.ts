// HubSpot pour Prospecting : contact garanti (création si absent, owner = le
// rep) et log des emails envoyés / reçus sur la timeline du contact.
//
// Best-effort : les fonctions "contrat" (ensureHubspotContact,
// logEmailToHubspot) ne lèvent jamais et retournent null en cas d'échec. Les
// variantes *Detailed exposent la raison pour journaliser `hubspot_failed`.
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { findHubspotContactIdByEmail, findOrCreateHubspotContact } from "@/lib/hubspot-contacts";
import { businessDomain, errMessage, nowIso } from "./store/util";
import type { ContactRow } from "./types";

export interface HubspotEmailLogInput {
  contact: ContactRow;
  userId: string;
  direction: "out" | "in";
  subject: string | null;
  body: string | null;
  at: string;
  fromEmail: string | null;
  toEmail: string | null;
}

// Type d'association HubSpot (HUBSPOT_DEFINED) : email -> contact.
const EMAIL_TO_CONTACT_ASSOCIATION = 198;
const MAX_TEXT = 60_000;

interface RepInfo {
  ownerId: string | null;
  name: string | null;
}

async function loadRep(userId: string): Promise<RepInfo> {
  const { data } = await db.from("users").select("hubspot_owner_id, name").eq("id", userId).maybeSingle();
  const row = data as { hubspot_owner_id: string | null; name: string | null } | null;
  return { ownerId: row?.hubspot_owner_id ?? null, name: row?.name ?? null };
}

function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export async function ensureHubspotContactDetailed(
  contact: ContactRow,
  userId: string,
): Promise<{ id: string | null; created: boolean; error: string | null }> {
  if (contact.hubspot_contact_id) return { id: contact.hubspot_contact_id, created: false, error: null };
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return { id: null, created: false, error: "HubSpot is not configured" };
  if (!contact.email) return { id: null, created: false, error: "No email address" };
  try {
    const rep = await loadRep(userId);
    const res = await findOrCreateHubspotContact({
      email: contact.email,
      firstName: contact.first_name,
      lastName: contact.last_name,
      jobTitle: contact.title,
      company: contact.company_name,
      phone: contact.phone,
      ownerId: rep.ownerId,
      companyDomain: businessDomain(contact.company_domain, contact.email),
      companyId: contact.hubspot_company_id,
    });
    const patch: Record<string, unknown> = { hubspot_contact_id: res.id, updated_at: nowIso() };
    if (res.companyId && !contact.hubspot_company_id) patch.hubspot_company_id = res.companyId;
    await db.from("prospecting_contacts").update(patch).eq("id", contact.id);
    contact.hubspot_contact_id = res.id;
    if (patch.hubspot_company_id) contact.hubspot_company_id = res.companyId;
    return { id: res.id, created: res.created, error: null };
  } catch (e) {
    const message = errMessage(e);
    console.error("[prospecting] ensureHubspotContact failed:", message);
    return { id: null, created: false, error: message };
  }
}

/** Garantit un contact HubSpot (création si absent, owner = le rep). Retourne son id ou null. */
export async function ensureHubspotContact(contact: ContactRow, userId: string): Promise<string | null> {
  return (await ensureHubspotContactDetailed(contact, userId)).id;
}

export async function logEmailToHubspotDetailed(input: HubspotEmailLogInput): Promise<{ id: string | null; error: string | null }> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return { id: null, error: "HubSpot is not configured" };
  try {
    // Pas de création ici : c'est le rôle d'ensureHubspotContact (option de campagne).
    const contactId =
      input.contact.hubspot_contact_id ?? (input.contact.email ? await findHubspotContactIdByEmail(input.contact.email) : null);
    if (!contactId) return { id: null, error: "Contact not found in HubSpot" };

    const rep = await loadRep(input.userId);
    const repName = splitName(rep.name);
    const prospect = { email: input.contact.email ?? input.toEmail ?? "", firstName: input.contact.first_name, lastName: input.contact.last_name };
    const repAddr = {
      email: (input.direction === "out" ? input.fromEmail : input.toEmail) ?? "",
      firstName: repName.firstName,
      lastName: repName.lastName,
    };
    const from = input.direction === "out" ? repAddr : { ...prospect, email: input.fromEmail ?? prospect.email };
    const to = input.direction === "out" ? { ...prospect, email: input.toEmail ?? prospect.email } : repAddr;

    const properties: Record<string, string> = {
      hs_timestamp: new Date(input.at).toISOString(),
      hs_email_direction: input.direction === "out" ? "EMAIL" : "INCOMING_EMAIL",
      hs_email_status: "SENT",
      hs_email_subject: (input.subject ?? "").slice(0, 500),
      hs_email_text: (input.body ?? "").slice(0, MAX_TEXT),
      hs_email_headers: JSON.stringify({ from, to: [to], cc: [], bcc: [] }),
    };
    if (rep.ownerId) properties.hubspot_owner_id = rep.ownerId;

    const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/emails", "POST", {
      properties,
      associations: [
        { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: EMAIL_TO_CONTACT_ASSOCIATION }] },
      ],
    });
    return { id: String(res.id), error: null };
  } catch (e) {
    const message = errMessage(e);
    console.error("[prospecting] logEmailToHubspot failed:", message);
    return { id: null, error: message };
  }
}

/** Log un email sur la timeline du contact HubSpot. Retourne l'id d'engagement ou null. */
export async function logEmailToHubspot(input: HubspotEmailLogInput): Promise<string | null> {
  return (await logEmailToHubspotDetailed(input)).id;
}
