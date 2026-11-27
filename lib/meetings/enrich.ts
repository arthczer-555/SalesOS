// Enrichissement d'une annonce : de ce que l'IA a lu (extract.ts) et des
// corrections du fil (overrides), on tire la proposition de carte. Ordre fixé
// par Arthur pour l'email du prospect : le lead validé (inbound), puis HubSpot,
// sinon on le demande dans le fil. Aucune écriture ici.

import { db } from "@/lib/db";
import { hubspotFetch, hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "@/lib/hubspot";
import { openCardsOfCompany, openCardsOfContact, readDealsLite, type DealLite } from "@/lib/hubspot/cards";
import { getStageLabels, isCustomerSuccessPipelineId, isTestDealName } from "@/lib/hubspot/pipeline-model";
import { jaroWinkler, normalizeCompany, normalizePerson } from "@/lib/fuzzy-match";
import {
  DEFAULT_SALE_TYPE,
  PARTNER_INBOUND_ORIGIN,
  isDealOrigin,
  isOfferType,
  isSaleType,
  originNeedsPartner,
  type DealOrigin,
  type OfferType,
  type SaleType,
} from "@/lib/leads/origin";
import { adminSlackIds, isInternalEmail, memberBySlackId, memberByOwnerId, type TeamMember } from "./roster";
import type { AnnouncementRow, Extraction, FieldSource, MissingField, Proposal, ProposalContact, SourceKey } from "./types";

const SOURCE_TO_ORIGIN: Record<Exclude<SourceKey, "unknown">, DealOrigin> = {
  inbound: "Inbound",
  outbound: "Outbound",
  referral: "Referral",
  network: "Network",
  events: "Tradeshows",
  partner_coprospecting: "Partnerships",
  partner_inbound: PARTNER_INBOUND_ORIGIN,
  existing_customer: "Existing Customer",
};

export const originOfSourceKey = (k: SourceKey | null | undefined): DealOrigin | null => (k && k !== "unknown" ? SOURCE_TO_ORIGIN[k] : null);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function domainOf(email: string | null | undefined): string | null {
  const d = (email ?? "").split("@")[1]?.trim().toLowerCase();
  return d && !PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(d) ? d : null;
}

function domainOfWebsite(site: string | null | undefined): string | null {
  const s = (site ?? "").trim().toLowerCase();
  if (!s) return null;
  try {
    const host = new URL(s.startsWith("http") ? s : `https://${s}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// ── HubSpot ─────────────────────────────────────────────────────────────────

interface HsContact {
  id: string;
  email: string | null;
  name: string | null;
  title: string | null;
  companyId: string | null;
}

const CONTACT_PROPS = ["email", "firstname", "lastname", "jobtitle", "associatedcompanyid"];

function toContact(r: { id: string; properties?: Record<string, string | null> }): HsContact {
  const p = r.properties ?? {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
  return { id: String(r.id), email: p.email?.toLowerCase() ?? null, name: name || null, title: p.jobtitle ?? null, companyId: p.associatedcompanyid ?? null };
}

async function contactByEmail(email: string): Promise<HsContact | null> {
  const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string | null> }>(
    "contacts",
    { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }], properties: CONTACT_PROPS, limit: 1 },
    1,
  );
  return rows[0] ? toContact(rows[0]) : null;
}

/** Contacts portant ce prénom et ce nom ; un seul attendu (sinon on préfère celui de la société). */
async function contactsByName(first: string, last: string): Promise<HsContact[]> {
  if (!first || !last) return [];
  const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string | null> }>(
    "contacts",
    {
      filterGroups: [{ filters: [{ propertyName: "firstname", operator: "EQ", value: first }, { propertyName: "lastname", operator: "EQ", value: last }] }],
      properties: CONTACT_PROPS,
      limit: 10,
    },
    10,
  );
  return rows.map(toContact);
}

// Mots de poste trop courants pour distinguer deux personnes ("Head of Talent
// Enablement" ne doit pas prendre "Head of Learning & Talent").
const GENERIC_TITLE_WORDS = new Set([
  "head", "director", "directeur", "directrice", "manager", "responsable", "group", "groupe", "global", "chief",
  "senior", "lead", "vice", "president", "officer", "and", "the", "des", "pour", "team",
]);

/** Contacts d'une société dont le poste contient tous les mots distinctifs du poste annoncé (annonce sans nom). */
async function contactsOfCompanyByTitle(companyId: string, title: string): Promise<HsContact[]> {
  const tokens = normalizePerson(title).split(" ").filter((t) => t.length >= 3 && !GENERIC_TITLE_WORDS.has(t));
  if (!tokens.length) return [];
  const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string | null> }>(
    "contacts",
    { filterGroups: [{ filters: [{ propertyName: "associatedcompanyid", operator: "EQ", value: companyId }] }], properties: CONTACT_PROPS, limit: 100 },
    100,
  );
  return rows
    .map(toContact)
    .filter((c) => {
      const words = new Set(normalizePerson(c.title ?? "").split(" "));
      return tokens.every((tok) => words.has(tok));
    });
}

async function companyByDomain(domain: string): Promise<{ id: string; name: string | null } | null> {
  const rows = await hubspotSearchAll<{ id: string; properties?: { name?: string | null } }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }], properties: ["name", "domain"], limit: 1 },
    1,
  );
  return rows[0] ? { id: rows[0].id, name: rows[0].properties?.name?.trim() || null } : null;
}

/** Société portant exactement ce nom, si elle est unique. */
async function companyByExactName(name: string): Promise<{ id: string; name: string | null } | null> {
  const clean = name.trim();
  if (!clean) return null;
  const rows = await hubspotSearchAll<{ id: string; properties?: { name?: string | null } }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: clean }] }], properties: ["name"], limit: 2 },
    2,
  );
  return rows.length === 1 ? { id: rows[0].id, name: rows[0].properties?.name?.trim() || null } : null;
}

/** Société au nom proche (faute de frappe) : recherche par préfixe, puis meilleur score unique >= 0.9. */
async function companyByFuzzyName(name: string): Promise<{ id: string; name: string | null } | null> {
  const norm = normalizeCompany(name);
  const seed = norm.split(" ").find((t) => t.length >= 4);
  if (!seed) return null;
  const rows = await hubspotSearchAll<{ id: string; properties?: { name?: string | null } }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: `${seed.slice(0, 4)}*` }] }], properties: ["name"], limit: 50 },
    50,
  );
  const scored = rows
    .map((r) => ({ id: r.id, name: r.properties?.name?.trim() || null, score: jaroWinkler(normalizeCompany(r.properties?.name ?? ""), norm) }))
    .filter((r) => r.score >= 0.9)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return { id: scored[0].id, name: scored[0].name };
}

async function companyName(companyId: string): Promise<string | null> {
  const res = await hubspotFetch<{ properties?: { name?: string | null } }>(`/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=name`);
  return res.properties?.name?.trim() || null;
}

/** Société déjà cliente : fiche client CoachelloHQ, deal gagné ou deal Customer Success. */
async function isExistingClient(companyId: string): Promise<boolean> {
  const { data } = await db.from("clients").select("id").eq("hubspot_company_id", companyId).limit(1);
  if (data?.length) return true;
  const { data: acc } = await db.from("clients").select("id").contains("account_companies", [{ id: companyId }]).limit(1);
  if (acc?.length) return true;
  const res = await hubspotFetch<{ results?: { toObjectId: string | number }[] }>(`/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/deals?limit=100`);
  const deals = await readDealsLite((res.results ?? []).map((r) => String(r.toObjectId)));
  return deals.some((d) => d.wonFlag || d.dealstage === "closedwon" || isCustomerSuccessPipelineId(d.pipeline));
}

// ── Lead validé (#1a-new-incoming-leads) ────────────────────────────────────

interface LeadMatch {
  id: string;
  validatedAt: string | null;
  permalink: string | null;
  email: string | null;
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  contactName: string | null;
  origin: DealOrigin | null;
  offerTypes: OfferType[];
  referringPartner: string | null;
  saleType: SaleType | null;
  ownerHubspotId: string | null;
  taskId: string | null;
  /** Comment le lead a été retrouvé (les deux derniers cas sont signalés dans la proposition). */
  matchedBy: "email" | "name" | "name_only" | "company_only";
}

type LeadDbRow = {
  id: string;
  validated_at: string | null;
  slack_permalink: string | null;
  contact_email: string | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  deal_origin: string | null;
  offer_types: string[] | null;
  referring_partner: string | null;
  analysis: { extracted_name: string | null; extracted_company: string | null; extracted_email: string | null } | { extracted_name: string | null; extracted_company: string | null; extracted_email: string | null }[] | null;
};

const tokensOf = (normalized: string) => normalized.split(" ").filter(Boolean);

/**
 * La personne annoncée est-elle celle du lead ? Tolère une faute de frappe
 * (Jaro-Winkler), un nom composé ou un deuxième prénom ("Claire Martin" pour
 * "Claire Martin-Dupont"), une initiale ("C. Martin"), et un prénom ou un nom
 * seul quand la société correspond nettement (companyStrong).
 */
export function personMatches(announced: string, leadName: string, companyStrong: boolean): boolean {
  const a = normalizePerson(announced);
  const b = normalizePerson(leadName);
  if (!a || !b) return false;
  if (jaroWinkler(a, b) >= 0.9) return true;
  const ta = tokensOf(a);
  const tb = new Set(tokensOf(b));
  const full = ta.filter((t) => t.length > 1);
  const initials = ta.filter((t) => t.length === 1);
  if (full.length >= 2 && full.every((t) => tb.has(t))) return true;
  if (full.length >= 1 && initials.length >= 1 && full.every((t) => tb.has(t)) && initials.every((i) => [...tb].some((t) => t.startsWith(i)))) return true;
  if (ta.length === 1 && companyStrong && tb.has(ta[0])) return true;
  return false;
}

/**
 * Lead validé des 120 derniers jours, dans cet ordre : par email ; par
 * personne + société (fautes de frappe tolérées) ; par nom complet très proche
 * même si la société diffère (sigle, marque) ; par société seule quand
 * l'annonce ne nomme personne et qu'un seul lead correspond.
 */
async function findValidatedLead(emails: string[], name: string | null, company: string | null): Promise<LeadMatch | null> {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("leads")
    .select(
      "id, validated_at, slack_permalink, contact_email, hubspot_contact_id, hubspot_company_id, deal_origin, offer_types, referring_partner, analysis:lead_analyses!leads_last_analysis_id_fkey(extracted_name, extracted_company, extracted_email)",
    )
    .eq("validation_status", "validated")
    .gte("validated_at", since)
    .order("validated_at", { ascending: false })
    .limit(300);
  if (error || !data?.length) return null;
  const rows = data as unknown as LeadDbRow[];
  const first = (a: LeadDbRow["analysis"]) => (Array.isArray(a) ? a[0] ?? null : a);
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  let hit = rows.find((r) => {
    const a = first(r.analysis);
    return [r.contact_email, a?.extracted_email].some((e) => e && wanted.has(e.toLowerCase()));
  });
  let matchedBy: LeadMatch["matchedBy"] = "email";
  const companySim = (r: LeadDbRow) => {
    const a = first(r.analysis);
    return company && a?.extracted_company ? jaroWinkler(normalizeCompany(a.extracted_company), normalizeCompany(company)) : 0;
  };
  if (!hit && name) {
    hit = rows.find((r) => {
      const a = first(r.analysis);
      const sim = companySim(r);
      return !!a?.extracted_name && sim >= 0.85 && personMatches(name, a.extracted_name, sim >= 0.9);
    });
    if (hit) matchedBy = "name";
  }
  if (!hit && name && tokensOf(normalizePerson(name)).length >= 2) {
    // Nom complet quasi identique : la société annoncée peut être un sigle ou une marque ("SG", "Russell Stover").
    hit = rows.find((r) => {
      const a = first(r.analysis);
      return !!a?.extracted_name && jaroWinkler(normalizePerson(a.extracted_name), normalizePerson(name)) >= 0.95;
    });
    if (hit) matchedBy = "name_only";
  }
  if (!hit && !name && company) {
    const same = rows.filter((r) => companySim(r) >= 0.9);
    if (same.length === 1) {
      hit = same[0];
      matchedBy = "company_only";
    }
  }
  if (!hit) return null;
  const a = first(hit.analysis);
  // Colonnes du 27/11 (migration lead_call_task.sql) : lecture à part, tolérante.
  const { data: extras } = await db.from("leads").select("hubspot_task_id, owner_hubspot_id, sale_type").eq("id", hit.id).maybeSingle();
  const x = (extras ?? null) as { hubspot_task_id: string | null; owner_hubspot_id: string | null; sale_type: string | null } | null;
  return {
    id: hit.id,
    validatedAt: hit.validated_at,
    permalink: hit.slack_permalink,
    email: (hit.contact_email || a?.extracted_email || null)?.toLowerCase() ?? null,
    contactId: hit.hubspot_contact_id,
    companyId: hit.hubspot_company_id,
    companyName: a?.extracted_company ?? null,
    contactName: a?.extracted_name ?? null,
    origin: isDealOrigin(hit.deal_origin) ? hit.deal_origin : null,
    offerTypes: (hit.offer_types ?? []).filter(isOfferType),
    referringPartner: hit.referring_partner,
    saleType: isSaleType(x?.sale_type) ? (x?.sale_type as SaleType) : null,
    ownerHubspotId: x?.owner_hubspot_id ?? null,
    taskId: x?.hubspot_task_id ?? null,
    matchedBy,
  };
}

// ── Doublon ─────────────────────────────────────────────────────────────────

async function findDuplicate(row: AnnouncementRow, emails: string[], companyId: string | null): Promise<{ id: string; permalink: string | null } | null> {
  if (!emails.length && !companyId) return null;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let q = db
    .from("meeting_announcements")
    .select("id, slack_permalink, contact_emails, hubspot_company_id")
    .neq("id", row.id)
    .eq("mode", row.mode)
    .in("status", ["proposed", "awaiting_info", "creating", "created", "linked"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20);
  if (emails.length && companyId) q = q.or(`contact_emails.ov.{${emails.join(",")}},hubspot_company_id.eq.${companyId}`);
  else if (emails.length) q = q.overlaps("contact_emails", emails);
  else q = q.eq("hubspot_company_id", companyId as string);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const d = data[0] as { id: string; slack_permalink: string | null };
  return { id: d.id, permalink: d.slack_permalink };
}

// ── Proposition ─────────────────────────────────────────────────────────────

export interface EnrichContext {
  roster: TeamMember[];
  testMode: boolean;
  testUserSlackId: string | null;
}

export async function buildProposal(row: AnnouncementRow, extraction: Extraction, ctx: EnrichContext): Promise<Proposal> {
  const o = row.overrides ?? {};
  const warnings: string[] = [];
  const roster = ctx.roster;

  // Contacts (jamais un collègue Coachello).
  const extracted = extraction.contacts.filter((c) => !isInternalEmail(c.email, roster));
  const primaryRaw = extracted[0] ?? { first_name: "", last_name: "", title: "", email: "" };
  let primaryName = [primaryRaw.first_name, primaryRaw.last_name].filter(Boolean).join(" ").trim() || null;
  let primaryTitle = primaryRaw.title || null;
  let primaryEmail: string | null = primaryRaw.email || null;
  let emailSource: FieldSource | null = primaryEmail ? "post" : null;
  if (o.contactName) primaryName = o.contactName;
  if (o.contactTitle) primaryTitle = o.contactTitle;
  if (o.contactEmail) {
    primaryEmail = o.contactEmail.toLowerCase();
    emailSource = "thread";
  }
  let companyLabel: string | null = o.companyName || extraction.company_name || null;
  let companySource: FieldSource | null = o.companyName ? "thread" : extraction.company_name ? "post" : null;

  // 1. Lead validé.
  const knownEmails = [primaryEmail, ...extracted.slice(1).map((c) => c.email)].filter((e): e is string => !!e);
  let lead: LeadMatch | null = null;
  try {
    lead = await findValidatedLead(knownEmails, primaryName, companyLabel);
  } catch (e) {
    console.warn("[meetings/enrich] inbound leads not checked:", errMsg(e));
    warnings.push("I could not check the inbound leads: some details may be missing.");
  }
  if (lead?.matchedBy === "company_only") warnings.push(`Matched to the inbound lead of ${lead.companyName ?? "this company"} (${lead.contactName ?? "contact"}) : check it is the right contact.`);
  if (lead?.matchedBy === "name_only") warnings.push(`Found the inbound lead of ${lead.contactName ?? "this contact"} at ${lead.companyName ?? "another company"}: check the company.`);
  if (lead) {
    if (!primaryEmail && lead.email) {
      primaryEmail = lead.email;
      emailSource = "lead";
    }
    if (!primaryName && lead.contactName) primaryName = lead.contactName;
    if (!companyLabel && lead.companyName) {
      companyLabel = lead.companyName;
      companySource = "lead";
    }
  }

  // 2. HubSpot : contact, puis société.
  let hsContact: HsContact | null = null;
  let companyId: string | null = lead?.companyId ?? null;
  let hubspotCompanyName: string | null = null;
  let domain = domainOf(primaryEmail) ?? domainOfWebsite(extraction.company_website);
  try {
    if (primaryEmail) hsContact = await contactByEmail(primaryEmail);
    else if (lead?.contactId) hsContact = { id: lead.contactId, email: lead.email, name: lead.contactName, title: null, companyId: lead.companyId };
    else if (primaryName) {
      const { first, last } = splitName(primaryName);
      const found = await contactsByName(first, last);
      const ofCompany = companyId ? found.filter((c) => c.companyId === companyId) : [];
      const pick = ofCompany.length === 1 ? ofCompany[0] : found.length === 1 ? found[0] : null;
      if (pick) hsContact = pick;
      else if (found.length > 1) warnings.push(`Several contacts are named ${primaryName}: reply with the right email.`);
    }
    if (hsContact) {
      if (!primaryEmail && hsContact.email) {
        primaryEmail = hsContact.email;
        emailSource = "hubspot";
      }
      // Nom de la fiche HubSpot repris s'il manque ou s'il est proche (faute de frappe dans l'annonce).
      if (hsContact.name && !o.contactName && (!primaryName || jaroWinkler(normalizePerson(hsContact.name), normalizePerson(primaryName)) >= 0.85 || personMatches(primaryName, hsContact.name, true))) primaryName = hsContact.name;
      if (!primaryTitle && hsContact.title) primaryTitle = hsContact.title;
      if (!companyId && hsContact.companyId) companyId = hsContact.companyId;
    }
    domain = domain ?? domainOf(primaryEmail);
    if (!companyId && domain) {
      const c = await companyByDomain(domain);
      if (c) companyId = c.id;
    }
    if (!companyId && companyLabel) {
      const c = (await companyByExactName(companyLabel)) ?? (await companyByFuzzyName(companyLabel));
      if (c) companyId = c.id;
    }
    // Nom HubSpot de la société : il remplace le nom annoncé seulement si l'annonce
    // n'en donnait pas (une filiale ne prend pas le nom de sa maison mère).
    if (companyId) {
      hubspotCompanyName = await companyName(companyId).catch(() => null);
      const close = !!hubspotCompanyName && !!companyLabel && jaroWinkler(normalizeCompany(hubspotCompanyName), normalizeCompany(companyLabel)) >= 0.85;
      // Nom HubSpot repris si l'annonce n'en donnait pas, ou s'il est proche (faute de frappe corrigée).
      // Très différent (filiale, marque) : le nom annoncé reste, le nom HubSpot est affiché à côté.
      if (hubspotCompanyName && !o.companyName && (!companyLabel || close)) {
        companyLabel = hubspotCompanyName;
        companySource = companySource ?? "hubspot";
      }
    }
    // Annonce sans nom ni email ("Head of Talent - Aviv Group") : contacts de la société par poste.
    if (!hsContact && !primaryEmail && !primaryName && primaryTitle && companyId) {
      const byTitle = await contactsOfCompanyByTitle(companyId, primaryTitle);
      if (byTitle.length === 1) {
        hsContact = byTitle[0];
        primaryEmail = hsContact.email;
        primaryName = hsContact.name;
        emailSource = "hubspot";
        warnings.push(`Contact found by job title (${hsContact.title}): check it is the right person.`);
      }
    }
  } catch (e) {
    console.warn("[meetings/enrich] HubSpot lookup incomplete:", errMsg(e));
    warnings.push("I could not check HubSpot completely: some details may be missing.");
  }

  const contacts: ProposalContact[] = [
    { name: primaryName, title: primaryTitle, email: primaryEmail, hubspotContactId: hsContact?.id ?? null, emailSource },
    ...extracted.slice(1).map((c) => ({ name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null, title: c.title || null, email: c.email || null, hubspotContactId: null, emailSource: c.email ? ("post" as FieldSource) : null })),
    ...(o.extraContacts ?? []).map((c) => ({ name: c.name, title: null, email: c.email.toLowerCase(), hubspotContactId: null, emailSource: "thread" as FieldSource })),
  ].filter((c, i) => i === 0 || c.name || c.email);

  // 3. Carte ouverte (Prospection ou Sales) du contact ou de la société.
  let existingCard: Proposal["existingCard"] = null;
  try {
    const open: DealLite[] = [];
    if (hsContact) open.push(...(await openCardsOfContact(hsContact.id)));
    if (companyId) open.push(...(await openCardsOfCompany(companyId)));
    const visible = open.filter((d) => (ctx.testMode ? true : !isTestDealName(d.dealname)));
    const pick = visible.sort((a, b) => b.lastModified.localeCompare(a.lastModified))[0];
    if (pick) {
      const labels = await getStageLabels().catch(() => ({ stages: {} as Record<string, string>, pipelines: {} as Record<string, string> }));
      existingCard = { id: pick.id, name: pick.dealname || pick.id, stageLabel: labels.stages[pick.dealstage] ?? null, pipelineLabel: labels.pipelines[pick.pipeline] ?? null };
    }
  } catch (e) {
    console.warn("[meetings/enrich] open cards not checked:", errMsg(e));
    warnings.push("I could not check for an existing card.");
  }

  // 4. Client, partenaire.
  let kind = extraction.meeting_kind;
  if (companyId) {
    const client = await isExistingClient(companyId).catch(() => false);
    if (client) {
      if (kind === "prospect") kind = "client";
      warnings.push(`${companyLabel ?? "This company"} is already a client.`);
    }
  }
  // Meeting partenaire ou non commercial : l'en-tête et la consigne du message le disent (proposal.ts).

  // 5. Owner : correction du fil, collègue qui mène le meeting, sinon l'auteur.
  const poster = memberBySlackId(roster, row.posted_by_slack_id);
  let owner: Proposal["owner"] = null;
  const asOwner = (m: TeamMember, source: NonNullable<Proposal["owner"]>["source"]) => ({ userId: m.userId, name: m.name, hubspotOwnerId: m.hubspotOwnerId, slackUserId: m.slackUserId, source });
  const fromThread = memberBySlackId(roster, o.ownerSlackId);
  const runner = memberBySlackId(roster, extraction.runner_slack_id);
  if (fromThread) owner = asOwner(fromThread, "thread");
  else if (runner?.hubspotOwnerId) owner = asOwner(runner, "runner");
  else {
    if (runner && !runner.hubspotOwnerId) warnings.push(`${runner.name} cannot own cards yet: the owner is the author for now.`);
    if (poster) owner = asOwner(poster, "post");
  }
  if (!owner && lead?.ownerHubspotId) {
    const m = memberByOwnerId(roster, lead.ownerHubspotId);
    if (m) owner = asOwner(m, "lead");
  }
  if (lead?.ownerHubspotId && owner?.hubspotOwnerId && lead.ownerHubspotId !== owner.hubspotOwnerId) {
    const leadOwner = memberByOwnerId(roster, lead.ownerHubspotId);
    warnings.push(`The inbound lead was assigned to ${leadOwner?.name ?? "someone else"}.`);
  }

  // 6. Source, offre, type de vente, partenaire.
  let origin: DealOrigin | null = originOfSourceKey(o.sourceKey);
  let originSource: FieldSource | null = origin ? "thread" : null;
  if (!origin && lead?.origin) {
    origin = lead.origin;
    originSource = "lead";
  }
  if (!origin) {
    origin = originOfSourceKey(extraction.source_key) ?? (kind === "client" ? "Existing Customer" : null);
    originSource = origin ? "post" : null;
  }
  const offerTypes = o.offerTypes ?? (lead?.offerTypes.length ? lead.offerTypes : extraction.offer_types);
  const saleType: SaleType = o.saleType ?? lead?.saleType ?? (extraction.is_rfp ? "rfp" : DEFAULT_SALE_TYPE);
  const referringPartner = o.referringPartner || lead?.referringPartner || extraction.referring_partner || null;

  // 7. Action.
  let action: Proposal["action"] = "create";
  if ((kind === "partner" || kind === "other") && !o.createCardAnyway) action = "none";
  else if (existingCard && o.cardAction !== "new_card") action = "link";

  // 8. Doublon.
  const emailsForDup = contacts.map((c) => c.email).filter((e): e is string => !!e);
  const duplicateOf = await findDuplicate(row, emailsForDup, companyId).catch(() => null);

  // 9. Ce qui manque pour créer.
  const missing: MissingField[] = [];
  if (action === "create") {
    if (!primaryEmail && !o.forceNoEmail) missing.push("email");
    if (!companyLabel && !primaryName) missing.push("company");
    if (!origin) missing.push("source");
    if (origin && originNeedsPartner(origin) && !referringPartner) missing.push("partner");
  }
  if (action !== "none" && !owner?.hubspotOwnerId) missing.push("owner");

  // 10. Qui peut valider : l'auteur, l'owner proposé, les admins (en test : la personne qui teste).
  const allowed = ctx.testMode
    ? [ctx.testUserSlackId].filter((s): s is string => !!s)
    : [...new Set([row.posted_by_slack_id, owner?.slackUserId, ...adminSlackIds(roster)].filter((s): s is string => !!s))];

  return {
    version: (row.proposal?.version ?? 0) + 1,
    kind,
    contacts,
    company: {
      name: companyLabel,
      hubspotCompanyId: companyId,
      hubspotName: hubspotCompanyName && companyLabel && jaroWinkler(normalizeCompany(hubspotCompanyName), normalizeCompany(companyLabel)) < 0.85 ? hubspotCompanyName : null,
      domain,
      source: companySource,
    },
    meetingDate: o.meetingDate || extraction.meeting_date || null,
    meetingTime: o.meetingTime || extraction.meeting_time || null,
    owner,
    origin,
    originSource,
    sourceDetail: extraction.source_detail || null,
    referringPartner,
    offerTypes,
    saleType,
    lead: lead ? { id: lead.id, validatedAt: lead.validatedAt, permalink: lead.permalink, taskId: lead.taskId } : null,
    existingCard,
    action,
    duplicateOf,
    warnings,
    missing,
    allowedSlackUserIds: allowed,
    cardName: companyLabel || primaryName || "New meeting",
  };
}
