// Types et helpers PURS des sources de prospects (Apollo, HubSpot, listes,
// Watch List, collage manuel). Aucun import serveur : utilisé par le drawer
// d'ajout côté client ET par les routes / jobs côté serveur.
import { sizeToApolloRange } from "../personas";
import type { LeadInput, Persona } from "../types";

export type SourceKey = "apollo" | "hubspot" | "csv" | "manual" | "lists" | "watchlist";

/**
 * URLs LinkedIn max par job linkedin_resolve. Pire cas 50 x 45 s / 3 en
 * parallèle = 12,5 min : reste sous la limite de 15 min d'une Background
 * Function Netlify.
 */
export const LINKEDIN_RESOLVE_MAX_URLS = 50;

// ── Apollo ──────────────────────────────────────────────────────────────────

export interface ApolloFilters {
  titles: string[];
  seniorities: string[];
  /** Tailles au format persona ("201-500", "10001+"), converties en tranches Apollo côté serveur. */
  companySizes: string[];
  /** Localisation de la personne. */
  locations: string[];
  /** Localisation du siège de l'entreprise. */
  organizationLocations: string[];
  domains: string[];
  keywords: string;
  industryKeywords: string[];
  /** Nom d'entreprise (utilisé seulement sans domaine, ex. compte Watch List sans domaine connu). */
  organizationName?: string;
}

export const EMPTY_APOLLO_FILTERS: ApolloFilters = {
  titles: [],
  seniorities: [],
  companySizes: [],
  locations: [],
  organizationLocations: [],
  domains: [],
  keywords: "",
  industryKeywords: [],
};

/** Préréglage Apollo depuis la cible d'un persona (titres, séniorités, tailles, zones, secteurs). */
export function personaToApolloFilters(persona: Persona): ApolloFilters {
  const t = persona.targeting;
  return {
    ...EMPTY_APOLLO_FILTERS,
    titles: [...t.titles],
    seniorities: [...t.seniorities],
    companySizes: [...t.companySizes],
    locations: [...t.locations],
    industryKeywords: [...t.industries],
  };
}

export function hasApolloFilter(f: ApolloFilters): boolean {
  return (
    f.titles.length > 0 ||
    f.seniorities.length > 0 ||
    f.companySizes.length > 0 ||
    f.locations.length > 0 ||
    f.organizationLocations.length > 0 ||
    f.domains.length > 0 ||
    f.industryKeywords.length > 0 ||
    f.keywords.trim().length > 0 ||
    !!f.organizationName?.trim()
  );
}

/** Tailles persona -> tranches Apollo ("201,500"), invalides ignorées. */
export function companySizesToRanges(sizes: string[]): string[] {
  return sizes.map(sizeToApolloRange).filter((x): x is string => !!x);
}

/** Normalise un objet de filtres reçu en JSON (champs manquants ou mal typés). */
export function normalizeApolloFilters(raw: unknown): ApolloFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 100) : [];
  return {
    titles: arr(r.titles),
    seniorities: arr(r.seniorities),
    companySizes: arr(r.companySizes),
    locations: arr(r.locations),
    organizationLocations: arr(r.organizationLocations),
    domains: arr(r.domains).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")),
    keywords: typeof r.keywords === "string" ? r.keywords.trim().slice(0, 200) : "",
    industryKeywords: arr(r.industryKeywords),
    organizationName: typeof r.organizationName === "string" && r.organizationName.trim() ? r.organizationName.trim() : undefined,
  };
}

export interface ApolloProspect {
  apolloId: string;
  firstName: string;
  /** Nom complet quand Apollo le donne (rare en search). */
  lastName: string | null;
  /** Nom masqué par Apollo (ex. "Bi***m") : le vrai nom arrive avec l'email. */
  lastNameMasked: string | null;
  name_is_partial: boolean;
  title: string | null;
  seniority: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  /** Apollo indique avoir un email pour cette personne (null = inconnu). */
  hasEmail: boolean | null;
  /** Déjà dans le registre d'équipe : pas besoin de repayer un reveal. */
  alreadyKnown: { contactId: string; inHubspot: boolean; email: string | null } | null;
}

export interface ApolloSearchResponse {
  people: ApolloProspect[];
  total: number;
  page: number;
  perPage: number;
  configured: boolean;
}

export function apolloProspectToLead(p: ApolloProspect): LeadInput {
  return {
    firstName: p.firstName,
    lastName: p.lastName ?? "",
    email: p.alreadyKnown?.email ?? null,
    title: p.title,
    seniority: p.seniority,
    companyName: p.companyName,
    companyDomain: p.companyDomain,
    linkedinUrl: p.linkedinUrl,
    location: p.location,
    apolloId: p.apolloId,
    source: "apollo",
  };
}

// ── HubSpot ─────────────────────────────────────────────────────────────────

export interface HubspotProspect {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  companyId: string | null;
  industry: string;
  lifecyclestage: string;
  city: string;
  country: string;
  /** Timestamp ms ou ISO selon HubSpot ; vide si jamais contacté. */
  lastContacted: string;
  leadStatus: string;
  employees: string;
  source: string;
  linkedinUrl: string | null;
  createdAt: string;
  ownerId: string | null;
}

export interface HubspotSearchResponse {
  results: HubspotProspect[];
  nextCursor: string | null;
  total: number | null;
  myOwnerId: string | null;
  /** "My contacts" demandé mais aucun owner HubSpot relié : la recherche porte sur tous les contacts. */
  ownerMissing: boolean;
  /** Recherche IA : ce que le modèle a compris / trouvé. */
  explanation?: string;
}

export function hubspotProspectToLead(p: HubspotProspect): LeadInput {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email || null,
    title: p.jobTitle || null,
    companyName: p.company || null,
    industry: p.industry || null,
    location: [p.city, p.country].filter(Boolean).join(", ") || null,
    country: p.country || null,
    linkedinUrl: p.linkedinUrl,
    hubspotContactId: p.id,
    hubspotCompanyId: p.companyId,
    source: "hubspot",
  };
}

export const HUBSPOT_CONTACTED_OPTIONS: { value: string; label: string }[] = [
  { value: "never", label: "Never contacted" },
  { value: "not90", label: "Not contacted in 3 months" },
  { value: "not180", label: "Not contacted in 6 months" },
  { value: "not365", label: "Not contacted in 1 year" },
  { value: "lt7", label: "Contacted in the last 7 days" },
  { value: "lt30", label: "Contacted in the last 30 days" },
  { value: "30to60", label: "Contacted 30 to 60 days ago" },
  { value: "60to180", label: "Contacted 2 to 6 months ago" },
  { value: "180to365", label: "Contacted 6 to 12 months ago" },
  { value: "gt365", label: "Contacted over 1 year ago" },
];

export const HUBSPOT_LIFECYCLE_OPTIONS: { value: string; label: string }[] = [
  { value: "subscriber", label: "Subscriber" },
  { value: "lead", label: "Lead" },
  { value: "marketingqualifiedlead", label: "MQL" },
  { value: "salesqualifiedlead", label: "SQL" },
  { value: "opportunity", label: "Opportunity" },
  { value: "customer", label: "Customer" },
  { value: "evangelist", label: "Evangelist" },
  { value: "other", label: "Other" },
];

export function lifecycleLabel(stage: string): string {
  return HUBSPOT_LIFECYCLE_OPTIONS.find((o) => o.value === stage)?.label ?? stage;
}

// ── Listes sauvegardées & Watch List ────────────────────────────────────────

export interface SavedListSummary {
  id: string;
  name: string;
  source: string;
  count: number;
  updatedAt: string;
}

export interface SavedListDetail extends SavedListSummary {
  leads: LeadInput[];
}

export interface WatchAccountItem {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  hubspotCompanyId: string | null;
}

export interface WatchContactItem {
  lead: LeadInput;
  lastActivity: string | null;
}

export interface WatchContactsResponse {
  account: { id: string; name: string; domain: string | null; hubspotCompanyId: string | null };
  contacts: WatchContactItem[];
}

// ── Clés de sélection (client) ──────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(s: string | null | undefined): boolean {
  return EMAIL_RE.test((s ?? "").trim());
}

/** Username LinkedIn depuis une URL /in/ (version client, sans dépendance serveur). */
export function linkedinUsername(url: string | null | undefined): string | null {
  const m = (url ?? "").trim().match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/\/$/, "").toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

/**
 * Clé stable d'un prospect pour la sélection : dédoublonne entre sources
 * (même email ou même profil LinkedIn = même personne).
 */
export function leadSelectionKey(l: LeadInput): string {
  const e = (l.email ?? "").trim().toLowerCase();
  if (isEmail(e)) return `e:${e}`;
  const u = linkedinUsername(l.linkedinUrl);
  if (u) return `l:${u}`;
  if (l.apolloId) return `a:${l.apolloId}`;
  if (l.hubspotContactId) return `h:${l.hubspotContactId}`;
  return `n:${l.firstName.trim().toLowerCase()}|${l.lastName.trim().toLowerCase()}|${(l.companyName ?? "").trim().toLowerCase()}`;
}

/** Un prospect est exploitable s'il a un email, un profil LinkedIn, un id Apollo ou nom + entreprise. */
export function leadHasIdentity(l: LeadInput): boolean {
  return (
    isEmail(l.email) ||
    !!linkedinUsername(l.linkedinUrl) ||
    !!l.apolloId ||
    !!l.hubspotContactId ||
    !!(l.firstName.trim() && l.lastName.trim() && (l.companyName ?? "").trim())
  );
}

export function leadDisplayName(l: LeadInput): string {
  const n = `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim();
  if (n) return n;
  if (l.email) return l.email;
  const u = linkedinUsername(l.linkedinUrl);
  return u ? `linkedin.com/in/${u}` : "Unknown";
}

/** Prospect "LinkedIn seul" : nom et entreprise récupérés par le job linkedin_resolve. */
export function isLinkedinOnly(l: LeadInput): boolean {
  return !!linkedinUsername(l.linkedinUrl) && !isEmail(l.email) && !l.firstName.trim() && !l.lastName.trim() && !l.apolloId && !l.hubspotContactId;
}
