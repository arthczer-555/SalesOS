// Registre d'équipe des prospects (prospecting_contacts), dédupliqué par email,
// username LinkedIn, id Apollo puis id HubSpot. Un upsert complète les champs
// vides d'un contact existant sans écraser ce qui est déjà renseigné.
import { db } from "@/lib/db";
import type { ContactRow, LeadInput } from "../types";
import { businessDomain, chunk, linkedinUrlFromUsername, linkedinUsernameFromUrl, normEmail, nowIso } from "./util";

const s = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Nettoie un prospect brut (trim, email en minuscules, username LinkedIn, domaine). */
export function normalizeLead(raw: LeadInput): LeadInput {
  let firstName = (raw.firstName ?? "").trim();
  let lastName = (raw.lastName ?? "").trim();
  if (!lastName && firstName.includes(" ")) {
    const parts = firstName.split(/\s+/);
    firstName = parts.shift() ?? "";
    lastName = parts.join(" ");
  }
  const email = normEmail(raw.email);
  const username = linkedinUsernameFromUrl(raw.linkedinUrl);
  return {
    ...raw,
    firstName,
    lastName,
    email,
    emailStatus: email ? raw.emailStatus ?? null : null,
    title: s(raw.title),
    companyName: s(raw.companyName),
    companyDomain: businessDomain(raw.companyDomain, email),
    linkedinUrl: username ? linkedinUrlFromUsername(username) : s(raw.linkedinUrl),
    phone: s(raw.phone),
    location: s(raw.location),
    country: s(raw.country),
    industry: s(raw.industry),
    companySize: s(raw.companySize),
    seniority: s(raw.seniority),
    hubspotContactId: s(raw.hubspotContactId),
    hubspotCompanyId: s(raw.hubspotCompanyId),
    scopeCompanyId: s(raw.scopeCompanyId),
    apolloId: s(raw.apolloId),
    customFields: raw.customFields ?? {},
  };
}

export function leadKey(l: LeadInput): string | null {
  const e = normEmail(l.email);
  if (e) return `e:${e}`;
  const u = linkedinUsernameFromUrl(l.linkedinUrl);
  if (u) return `l:${u}`;
  if (l.apolloId) return `a:${l.apolloId}`;
  if (l.hubspotContactId) return `h:${l.hubspotContactId}`;
  return null;
}

export function displayName(c: Pick<ContactRow, "first_name" | "last_name" | "email">): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return n || c.email || "Unknown";
}

/** Contacts existants qui correspondent à ces prospects (par n'importe quelle clé). */
export async function findExistingContacts(leads: LeadInput[]): Promise<ContactRow[]> {
  const emails = Array.from(new Set(leads.map((l) => normEmail(l.email)).filter((x): x is string => !!x)));
  const usernames = Array.from(new Set(leads.map((l) => linkedinUsernameFromUrl(l.linkedinUrl)).filter((x): x is string => !!x)));
  const apollo = Array.from(new Set(leads.map((l) => l.apolloId).filter((x): x is string => !!x)));
  const hubspot = Array.from(new Set(leads.map((l) => l.hubspotContactId).filter((x): x is string => !!x)));
  const found = new Map<string, ContactRow>();
  const add = (rows: unknown[] | null) => {
    for (const r of (rows ?? []) as ContactRow[]) found.set(r.id, r);
  };
  const jobs: PromiseLike<void>[] = [];
  for (const c of chunk(emails, 200)) jobs.push(db.from("prospecting_contacts").select("*").in("email_lower", c).then(({ data }) => add(data)));
  for (const c of chunk(usernames, 200)) jobs.push(db.from("prospecting_contacts").select("*").in("linkedin_username", c).then(({ data }) => add(data)));
  for (const c of chunk(apollo, 200)) jobs.push(db.from("prospecting_contacts").select("*").in("apollo_id", c).then(({ data }) => add(data)));
  for (const c of chunk(hubspot, 200)) jobs.push(db.from("prospecting_contacts").select("*").in("hubspot_contact_id", c).then(({ data }) => add(data)));
  await Promise.all(jobs);
  return Array.from(found.values());
}

export function matchContact(lead: LeadInput, contacts: ContactRow[]): ContactRow | null {
  const e = normEmail(lead.email);
  const u = linkedinUsernameFromUrl(lead.linkedinUrl);
  return (
    (e && contacts.find((c) => c.email_lower === e)) ||
    (u && contacts.find((c) => (c.linkedin_username ?? "").toLowerCase() === u)) ||
    (lead.apolloId && contacts.find((c) => c.apollo_id === lead.apolloId)) ||
    (lead.hubspotContactId && contacts.find((c) => c.hubspot_contact_id === lead.hubspotContactId)) ||
    null
  );
}

function leadToInsert(l: LeadInput, userId: string, personaId: string | null) {
  return {
    email: l.email ?? null,
    email_status: l.emailStatus ?? (l.email ? "unverified" : null),
    first_name: l.firstName,
    last_name: l.lastName,
    title: l.title ?? null,
    seniority: l.seniority ?? null,
    company_name: l.companyName ?? null,
    company_domain: l.companyDomain ?? null,
    linkedin_url: l.linkedinUrl ?? null,
    linkedin_username: linkedinUsernameFromUrl(l.linkedinUrl),
    phone: l.phone ?? null,
    location: l.location ?? null,
    country: l.country ?? null,
    industry: l.industry ?? null,
    company_size: l.companySize ?? null,
    persona_id: personaId,
    hubspot_contact_id: l.hubspotContactId ?? null,
    hubspot_company_id: l.hubspotCompanyId ?? null,
    scope_company_id: l.scopeCompanyId ?? null,
    apollo_id: l.apolloId ?? null,
    source: l.source,
    custom_fields: l.customFields ?? {},
    created_by: userId,
  };
}

/** Patch des champs vides d'un contact existant à partir d'un prospect. */
function mergePatch(c: ContactRow, l: LeadInput, personaId: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const fill = (col: keyof ContactRow, v: string | null | undefined) => {
    if (v && !c[col]) patch[col as string] = v;
  };
  if (l.email && !c.email) {
    patch.email = l.email;
    patch.email_status = l.emailStatus ?? "unverified";
  } else if (l.email && c.email_lower === l.email && l.emailStatus === "verified" && c.email_status !== "verified" && c.email_status !== "bounced") {
    patch.email_status = "verified";
  }
  fill("first_name", l.firstName);
  fill("last_name", l.lastName);
  fill("title", l.title);
  fill("seniority", l.seniority);
  fill("company_name", l.companyName);
  fill("company_domain", l.companyDomain);
  fill("linkedin_url", l.linkedinUrl);
  if (!c.linkedin_username) {
    const u = linkedinUsernameFromUrl(l.linkedinUrl);
    if (u) patch.linkedin_username = u;
  }
  fill("phone", l.phone);
  fill("location", l.location);
  fill("country", l.country);
  fill("industry", l.industry);
  fill("company_size", l.companySize);
  fill("hubspot_contact_id", l.hubspotContactId);
  fill("hubspot_company_id", l.hubspotCompanyId);
  fill("scope_company_id", l.scopeCompanyId);
  fill("apollo_id", l.apolloId);
  if (personaId && !c.persona_id) patch.persona_id = personaId;
  if (l.customFields && Object.keys(l.customFields).length) {
    patch.custom_fields = { ...l.customFields, ...(c.custom_fields ?? {}) };
  }
  return patch;
}

/**
 * Crée ou complète les contacts. Retourne le contact pour chaque prospect (même
 * index). Les contraintes d'unicité absorbent les courses : en cas de conflit,
 * on relit l'existant.
 */
export async function upsertContacts(leadsRaw: LeadInput[], userId: string, personaId: string | null): Promise<(ContactRow | null)[]> {
  const leads = leadsRaw.map(normalizeLead);
  const existing = await findExistingContacts(leads);
  const out: (ContactRow | null)[] = new Array(leads.length).fill(null);
  const now = nowIso();

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const match = matchContact(l, existing);
    if (match) {
      const patch = mergePatch(match, l, personaId);
      if (Object.keys(patch).length) {
        const { data } = await db
          .from("prospecting_contacts")
          .update({ ...patch, updated_at: now })
          .eq("id", match.id)
          .select("*")
          .maybeSingle();
        const updated = (data as ContactRow | null) ?? { ...match, ...(patch as Partial<ContactRow>) };
        out[i] = updated;
        const idx = existing.findIndex((c) => c.id === match.id);
        if (idx >= 0) existing[idx] = updated;
      } else {
        out[i] = match;
      }
      continue;
    }
    const { data, error } = await db.from("prospecting_contacts").insert(leadToInsert(l, userId, personaId)).select("*").single();
    if (error) {
      // Conflit d'unicité (course ou doublon dans le lot) : relire l'existant.
      const again = await findExistingContacts([l]);
      out[i] = matchContact(l, again);
      if (out[i]) existing.push(out[i] as ContactRow);
      continue;
    }
    out[i] = data as ContactRow;
    existing.push(data as ContactRow);
  }
  return out;
}

export async function getContact(id: string): Promise<ContactRow | null> {
  const { data } = await db.from("prospecting_contacts").select("*").eq("id", id).maybeSingle();
  return (data as ContactRow | null) ?? null;
}
