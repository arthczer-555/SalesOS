// Source HubSpot du drawer d'ajout : recherche filtrée ("My contacts" via
// users.hubspot_owner_id, curseur), recherche en langage naturel (Haiku + tool
// search_contacts) et lookup gratuit d'un email avant un reveal Apollo.
// Logique reprise de app/api/prospection/{search,ai-search} (routes laissées en
// place jusqu'à la bascule).
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { anthropicClient } from "@/lib/anthropic-client";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { logUsage } from "@/lib/log-usage";
import { NO_EM_DASH_RULE_EN, stripEmDashes } from "@/lib/no-em-dash";
import { domainOfEmail, isPublicEmailDomain, linkedinUsernameFromUrl, normCompanyName, normDomain } from "../store/util";
import type { HubspotProspect, HubspotSearchResponse } from "./shared";

const PROPS = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "company",
  "associatedcompanyid",
  "industry",
  "lifecyclestage",
  "city",
  "country",
  "notes_last_contacted",
  "hs_lead_status",
  "numberofemployees",
  "hs_lead_source",
  "hubspot_owner_id",
  "linkedin_url",
  "createdate",
];

type HsFilter = { propertyName: string; operator: string; value?: string; highValue?: string };
type HsContact = { id: string; properties: Record<string, string | null | undefined> };
type HsSearchResponse = { results?: HsContact[]; paging?: { next?: { after?: string } }; total?: number };

export interface HubspotSearchParams {
  q?: string;
  company?: string;
  lifecyclestage?: string;
  industry?: string;
  country?: string;
  leadstatus?: string;
  /** never | not90 | not180 | not365 | lt7 | lt30 | 30to60 | 60to180 | 180to365 | gt365 */
  contacted?: string;
  companysize?: string;
  source?: string;
  createdyear?: string;
  /** alpha | lastcontact | recent | created */
  sort?: string;
  after?: string;
  /** null/"" = mes contacts, "all" = tous, sinon id d'owner HubSpot. */
  owner?: string | null;
  jobtitle?: string;
  limit?: number;
}

const DAY = 864e5;

function mapContact(c: HsContact): HubspotProspect {
  const p = c.properties ?? {};
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return {
    id: c.id,
    firstName: s("firstname"),
    lastName: s("lastname"),
    email: s("email"),
    jobTitle: s("jobtitle"),
    company: s("company"),
    companyId: s("associatedcompanyid") || null,
    industry: s("industry"),
    lifecyclestage: s("lifecyclestage"),
    city: s("city"),
    country: s("country"),
    lastContacted: s("notes_last_contacted"),
    leadStatus: s("hs_lead_status"),
    employees: s("numberofemployees"),
    source: s("hs_lead_source"),
    linkedinUrl: s("linkedin_url") || null,
    createdAt: s("createdate"),
    ownerId: s("hubspot_owner_id") || null,
  };
}

async function getMyOwnerId(userId: string): Promise<string | null> {
  const { data } = await db.from("users").select("hubspot_owner_id").eq("id", userId).maybeSingle();
  return (data as { hubspot_owner_id: string | null } | null)?.hubspot_owner_id ?? null;
}

/**
 * Filtres de base + variantes OR. HubSpot combine les filtres d'un groupe en ET
 * et les groupes en OU : "pas contacté depuis 6 mois" = (dernier contact avant
 * J-180) OU (jamais contacté), donc deux groupes avec les mêmes filtres de base.
 */
function buildFilterGroups(p: HubspotSearchParams, ownerId: string | null): { filters: HsFilter[] }[] {
  const base: HsFilter[] = [];
  if (ownerId) base.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId });
  if (p.company) base.push({ propertyName: "company", operator: "CONTAINS_TOKEN", value: `*${p.company}*` });
  if (p.jobtitle) base.push({ propertyName: "jobtitle", operator: "CONTAINS_TOKEN", value: `*${p.jobtitle}*` });
  if (p.lifecyclestage) base.push({ propertyName: "lifecyclestage", operator: "EQ", value: p.lifecyclestage });
  if (p.industry) base.push({ propertyName: "industry", operator: "EQ", value: p.industry });
  if (p.country) base.push({ propertyName: "country", operator: "EQ", value: p.country });
  if (p.leadstatus) base.push({ propertyName: "hs_lead_status", operator: "EQ", value: p.leadstatus });

  if (p.companysize) {
    const ranges: Record<string, [number, number | null]> = {
      "1-10": [1, 10],
      "11-50": [11, 50],
      "51-200": [51, 200],
      "201-1000": [201, 1000],
      "1000+": [1001, null],
    };
    const range = ranges[p.companysize];
    if (range) {
      base.push({ propertyName: "numberofemployees", operator: "GTE", value: String(range[0]) });
      if (range[1]) base.push({ propertyName: "numberofemployees", operator: "LTE", value: String(range[1]) });
    }
  }

  if (p.createdyear) {
    const year = parseInt(p.createdyear, 10);
    if (!isNaN(year)) {
      base.push({
        propertyName: "createdate",
        operator: "BETWEEN",
        value: String(new Date(year, 0, 1).getTime()),
        highValue: String(new Date(year + 1, 0, 1).getTime()),
      });
    }
  }

  const now = Date.now();
  const last = "notes_last_contacted";
  const c = p.contacted ?? "";
  const notSince = /^not(\d+)$/.exec(c);
  if (notSince) {
    const days = parseInt(notSince[1], 10);
    return [
      { filters: [...base, { propertyName: last, operator: "LTE", value: String(now - days * DAY) }] },
      { filters: [...base, { propertyName: last, operator: "NOT_HAS_PROPERTY" }] },
    ];
  }
  if (c === "never") base.push({ propertyName: last, operator: "NOT_HAS_PROPERTY" });
  else if (c === "lt7") base.push({ propertyName: last, operator: "GTE", value: String(now - 7 * DAY) });
  else if (c === "lt30") base.push({ propertyName: last, operator: "GTE", value: String(now - 30 * DAY) });
  else if (c === "30to60") base.push({ propertyName: last, operator: "BETWEEN", value: String(now - 60 * DAY), highValue: String(now - 30 * DAY) });
  else if (c === "60to180") base.push({ propertyName: last, operator: "BETWEEN", value: String(now - 180 * DAY), highValue: String(now - 60 * DAY) });
  else if (c === "180to365") base.push({ propertyName: last, operator: "BETWEEN", value: String(now - 365 * DAY), highValue: String(now - 180 * DAY) });
  else if (c === "gt365") base.push({ propertyName: last, operator: "LTE", value: String(now - 365 * DAY) });

  return base.length ? [{ filters: base }] : [];
}

const SORTS: Record<string, string> = {
  alpha: "firstname",
  lastcontact: "notes_last_contacted",
  recent: "hs_lastmodifieddate",
  created: "createdate",
};

/** Résout l'owner effectif : null/"" = moi (si relié), "all" = aucun filtre. */
async function resolveOwner(userId: string, owner: string | null | undefined): Promise<{ ownerId: string | null; myOwnerId: string | null; ownerMissing: boolean }> {
  const myOwnerId = await getMyOwnerId(userId);
  if (owner === "all") return { ownerId: null, myOwnerId, ownerMissing: false };
  if (owner) return { ownerId: owner, myOwnerId, ownerMissing: false };
  return { ownerId: myOwnerId, myOwnerId, ownerMissing: !myOwnerId };
}

async function runSearch(p: HubspotSearchParams, ownerId: string | null): Promise<{ results: HubspotProspect[]; nextCursor: string | null; total: number | null }> {
  const body: Record<string, unknown> = {
    limit: Math.min(Math.max(p.limit ?? 50, 1), 100),
    properties: PROPS,
    sorts: [{ propertyName: SORTS[p.sort ?? ""] ?? "hs_lastmodifieddate", direction: p.sort === "alpha" ? "ASCENDING" : "DESCENDING" }],
  };
  if (p.q) body.query = p.q;
  const groups = buildFilterGroups(p, ownerId);
  if (groups.length) body.filterGroups = groups;
  if (p.after) body.after = p.after;

  const data = await hubspotFetch<HsSearchResponse>("/crm/v3/objects/contacts/search", "POST", body);
  const all = (data.results ?? []).map(mapContact);
  // hs_lead_source n'est pas filtrable par l'API search : filtré après coup.
  const results = p.source ? all.filter((r) => r.source === p.source) : all;
  return { results, nextCursor: data.paging?.next?.after ?? null, total: typeof data.total === "number" ? data.total : null };
}

/** Recherche filtrée (mêmes paramètres que l'ancienne route /api/prospection/search). */
export async function searchHubspotContacts(userId: string, p: HubspotSearchParams): Promise<HubspotSearchResponse> {
  const { ownerId, myOwnerId, ownerMissing } = await resolveOwner(userId, p.owner);
  const r = await runSearch(p, ownerId);
  return { ...r, myOwnerId, ownerMissing };
}

// ── Recherche en langage naturel ────────────────────────────────────────────

const AI_MODEL = "claude-haiku-4-5-20251001";

const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description:
      "Search HubSpot contacts. Call it with the filters that best match the request. You can call it up to 3 times with different filters (e.g. title variants in English and French).",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Free text matched on name, email, company. Leave empty when filters are enough." },
        jobtitle: { type: "string", description: "One job title keyword, e.g. 'Sales', 'Head of Sales', 'DRH', 'People'." },
        company: { type: "string", description: "Company name keyword." },
        country: { type: "string", description: "Country as stored in HubSpot, e.g. 'France', 'United Kingdom'." },
        industry: { type: "string", description: "HubSpot industry value, e.g. 'COMPUTER_SOFTWARE', 'FINANCIAL_SERVICES'." },
        lifecyclestage: {
          type: "string",
          enum: ["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "evangelist", "other"],
        },
        contacted: {
          type: "string",
          enum: ["never", "not90", "not180", "not365", "lt7", "lt30", "30to60", "60to180", "180to365", "gt365"],
          description: "Last contact window. notN = not contacted in the last N days (includes never contacted).",
        },
        companysize: { type: "string", enum: ["1-10", "11-50", "51-200", "201-1000", "1000+"] },
      },
      required: [],
    },
  },
  {
    name: "finish",
    description: "Return the most relevant contact ids found by search_contacts (max 50), best first, with a one-sentence explanation in English.",
    input_schema: {
      type: "object" as const,
      properties: {
        explanation: { type: "string" },
        contact_ids: { type: "array", items: { type: "string" } },
      },
      required: ["explanation", "contact_ids"],
    },
  },
];

const AI_SYSTEM = `You help a B2B sales rep find prospects in their HubSpot CRM.
Translate the request into search_contacts calls (1 to 3 calls), then call finish with the ids of the contacts that truly match, best first.
Rules:
- Job titles: search one keyword per call (e.g. "Head of Sales", then "VP Sales"). Titles may be in English or French (DRH, Directeur Commercial).
- "Haven't contacted in 6 months" means contacted=not180. "Never contacted" means contacted=never.
- Never invent ids: only use ids returned by search_contacts.
- The explanation is one short sentence in English describing what you found.
${NO_EM_DASH_RULE_EN}`;

type AiSearchInput = {
  query?: string;
  jobtitle?: string;
  company?: string;
  country?: string;
  industry?: string;
  lifecyclestage?: string;
  contacted?: string;
  companysize?: string;
};

/** Recherche en langage naturel : Haiku pilote search_contacts puis renvoie une sélection. */
export async function aiSearchHubspotContacts(userId: string, query: string, owner: string | null | undefined): Promise<HubspotSearchResponse> {
  const { ownerId, myOwnerId, ownerMissing } = await resolveOwner(userId, owner);
  const client = anthropicClient({ timeout: 45_000, maxRetries: 1, creditContext: "Prospecting HubSpot AI search" });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Request: "${query}"` }];
  const found = new Map<string, HubspotProspect>();
  let tokensIn = 0;
  let tokensOut = 0;
  let explanation = "";
  let pickedIds: string[] | null = null;

  for (let iteration = 0; iteration < 5 && pickedIds === null; iteration++) {
    // Dernier tour : on force finish pour ne jamais boucler à vide.
    const force = iteration >= 3;
    const response = await withAnthropicRetry(
      () =>
        client.messages.create({
          model: AI_MODEL,
          max_tokens: 1200,
          system: AI_SYSTEM,
          tools: AI_TOOLS,
          tool_choice: force ? { type: "tool", name: "finish" } : { type: "any" },
          messages,
        }),
      { label: "prospecting-hubspot-ai-search", maxAttempts: 3 },
    );
    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      if (block.name === "finish") {
        const input = block.input as { explanation?: unknown; contact_ids?: unknown };
        explanation = typeof input.explanation === "string" ? stripEmDashes(input.explanation) : "";
        pickedIds = Array.isArray(input.contact_ids) ? input.contact_ids.filter((x): x is string => typeof x === "string") : [];
        results.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
        continue;
      }
      const input = (block.input ?? {}) as AiSearchInput;
      try {
        const r = await runSearch(
          {
            q: input.query?.trim() || undefined,
            jobtitle: input.jobtitle?.trim() || undefined,
            company: input.company?.trim() || undefined,
            country: input.country?.trim() || undefined,
            industry: input.industry?.trim() || undefined,
            lifecyclestage: input.lifecyclestage || undefined,
            contacted: input.contacted || undefined,
            companysize: input.companysize || undefined,
            limit: 50,
          },
          ownerId,
        );
        for (const c of r.results) found.set(c.id, c);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({
            total: r.total,
            contacts: r.results.map((c) => ({
              id: c.id,
              name: `${c.firstName} ${c.lastName}`.trim(),
              jobTitle: c.jobTitle,
              company: c.company,
              country: c.country,
              lifecyclestage: c.lifecyclestage,
              lastContacted: c.lastContacted || null,
            })),
          }),
        });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
      }
    }
    if (pickedIds !== null) break;
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
  }

  logUsage(userId, AI_MODEL, tokensIn, tokensOut, "prospection_search");

  const picked: string[] = pickedIds ?? [];
  const ordered = picked.length
    ? picked.map((id) => found.get(id)).filter((c): c is HubspotProspect => !!c)
    : Array.from(found.values());
  return {
    results: ordered.slice(0, 100),
    nextCursor: null,
    total: ordered.length,
    myOwnerId,
    ownerMissing,
    explanation: explanation || (ordered.length ? `Found ${ordered.length} matching contacts.` : "No matching contact found."),
  };
}

// ── Lookup gratuit d'un email avant reveal Apollo ───────────────────────────

export interface HubspotEmailLookup {
  email: string;
  hubspotContactId: string;
  hubspotCompanyId: string | null;
}

/**
 * Cherche dans HubSpot un contact homonyme (prénom + nom) dans la même
 * entreprise (domaine, nom d'entreprise ou profil LinkedIn identique) et
 * renvoie son email pro. Gratuit : évite de payer un crédit Apollo pour un
 * email que l'équipe a déjà. null si rien de sûr (homonyme ambigu, email perso).
 */
export async function findEmailInHubspot(person: {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
}): Promise<HubspotEmailLookup | null> {
  const first = person.firstName.trim();
  const last = person.lastName.trim();
  if (!first || !last) return null;
  const domain = normDomain(person.companyDomain);
  const company = normCompanyName(person.companyName);
  const username = linkedinUsernameFromUrl(person.linkedinUrl);
  if (!domain && !company && !username) return null;

  const data = await hubspotFetch<HsSearchResponse>("/crm/v3/objects/contacts/search", "POST", {
    limit: 10,
    properties: ["email", "company", "linkedin_url", "associatedcompanyid", "firstname", "lastname"],
    filterGroups: [
      {
        filters: [
          { propertyName: "firstname", operator: "EQ", value: first },
          { propertyName: "lastname", operator: "EQ", value: last },
        ],
      },
    ],
  });

  for (const c of data.results ?? []) {
    const p = c.properties ?? {};
    const email = (p.email ?? "").trim().toLowerCase();
    const emailDomain = domainOfEmail(email);
    if (!emailDomain || isPublicEmailDomain(emailDomain)) continue;
    const hsUser = linkedinUsernameFromUrl(p.linkedin_url ?? null);
    const hsCompany = normCompanyName(p.company ?? "");
    const sameLinkedin = !!username && !!hsUser && hsUser === username;
    const sameDomain = !!domain && (emailDomain === domain || emailDomain.endsWith(`.${domain}`));
    // Inclusion tolérée seulement sur des noms assez longs ("ey" ne doit pas matcher "key").
    const shorter = Math.min(company.length, hsCompany.length);
    const sameCompany =
      !!company && !!hsCompany && (hsCompany === company || (shorter >= 4 && (hsCompany.includes(company) || company.includes(hsCompany))));
    if (sameLinkedin || sameDomain || sameCompany) {
      return { email, hubspotContactId: c.id, hubspotCompanyId: (p.associatedcompanyid ?? "") || null };
    }
  }
  return null;
}
