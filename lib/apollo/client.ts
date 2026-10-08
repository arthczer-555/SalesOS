/**
 * Client Apollo.io (testbed).
 *
 * Deux usages :
 * - `searchPeople` : People Search (POST /v1/mixed_people/search), filtré par
 *   domaine d'entreprise + titres (ICP) + séniorité. Les emails sont MASQUÉS
 *   tant qu'on ne les révèle pas (Apollo renvoie email_not_unlocked@...).
 * - `revealPerson` : People Match (POST /v1/people/match) avec révélation de
 *   l'email. CONSOMME UN CRÉDIT email Apollo. À déclencher à la demande.
 *
 * Best-effort : ne lève jamais sur un statut HTTP non-2xx, renvoie le détail
 * dans `ApolloResult` (la page de test lit data + rateLimit même en erreur).
 */

import { reportInsufficientCredit } from "@/lib/credit-alert";
import { INSUFFICIENT_CREDIT_MESSAGE, isCreditText } from "@/lib/credit-error";

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const BASE = "https://api.apollo.io/v1";

export interface ApolloResult<T = unknown> {
  ok: boolean;
  status: number;
  /** Latence de l'appel (ms). */
  ms: number;
  /** Body JSON parsé renvoyé par Apollo, ou texte brut si non-JSON. */
  data: T | { raw: string } | null;
  /** Headers x-* utiles au monitoring (rate limit, requêtes restantes). */
  rateLimit: Record<string, string>;
  /** Message d'erreur normalisé si !ok ou clé absente. */
  error?: string;
}

export interface ApolloPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  organization_name: string | null;
  /** Domaine officiel de la société (`organization.primary_domain`). Présent sur
   *  /people/match, ABSENT de /mixed_people/api_search (cf. `name_is_partial`). */
  organization_domain: string | null;
  /**
   * Vrai quand People Search a masqué le nom de famille (`last_name_obfuscated`,
   * ex. "Bi***m"). Dans ce cas `last_name` et `name` sont null : la personne est
   * REVELABLE (via `id`, 1 crédit) mais son email n'est pas DEVINABLE. Les deux
   * chemins n'ont rien à voir, d'où ce drapeau plutôt qu'un nom tronqué.
   */
  name_is_partial: boolean;
  /** Numéro de tél. présent dans la réponse synchrone (rare : le reveal Apollo
   *  est en général async via webhook). null si absent. */
  phone: string | null;
}

// Extrait un numéro depuis un objet personne Apollo (réponse synchrone).
// Privilégie un mobile, puis n'importe quel numéro avec sanitized/raw.
function extractPhone(p: Record<string, unknown>): string | null {
  const arr = Array.isArray(p.phone_numbers) ? (p.phone_numbers as Array<Record<string, unknown>>) : [];
  const pick =
    arr.find(
      (n) =>
        typeof n.type === "string" &&
        (n.type as string).toLowerCase().includes("mobile") &&
        (n.sanitized_number || n.raw_number),
    ) ?? arr.find((n) => n.sanitized_number || n.raw_number);
  const fromArr = pick ? ((pick.sanitized_number as string) || (pick.raw_number as string) || null) : null;
  return (p.sanitized_phone as string) || fromArr || null;
}

// Headers de quota qu'Apollo renvoie (on capte tout ce qui commence par x-).
function pickRateLimit(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("x-rate-limit") || k.includes("requests-left") || k.includes("minute") || k.includes("hour") || k.includes("day")) {
      out[k] = value;
    }
  });
  return out;
}

async function apolloFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<ApolloResult<T>> {
  if (!APOLLO_API_KEY) {
    return { ok: false, status: 0, ms: 0, data: null, rateLimit: {}, error: "APOLLO_API_KEY manquante (voir .env.local)" };
  }
  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - start), data: null, rateLimit: {}, error: e instanceof Error ? e.message : String(e) };
  }
  const ms = Math.round(performance.now() - start);
  const rateLimit = pickRateLimit(res.headers);
  const text = await res.text();
  let data: T | { raw: string } | null = null;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = { raw: text };
  }
  let error = res.ok ? undefined : ((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  // Crédits Apollo épuisés (402 ou message explicite) : message unique côté UI
  // + DM Slack à Gaspard/Arthur. On garde le contrat "ne lève jamais".
  if (!res.ok && (res.status === 402 || isCreditText(text) || isCreditText(error))) {
    await reportInsufficientCredit({
      provider: "Apollo",
      detail: error ?? text,
      context: `Apollo ${endpoint}`,
    });
    error = INSUFFICIENT_CREDIT_MESSAGE;
  }
  return { ok: res.ok, status: res.status, ms, data, rateLimit, error };
}

function mapPerson(p: Record<string, unknown>): ApolloPerson {
  const org = (p.organization as Record<string, unknown> | null) ?? null;
  const lastName = (p.last_name as string) ?? null;
  // People Search renvoie `last_name_obfuscated: "Bi***m"` au lieu du nom : on ne
  // le mappe PAS sur last_name (ce serait un faux nom qui finirait dans un email
  // deviné), on lève juste le drapeau.
  const partial = !lastName && typeof p.last_name_obfuscated === "string";
  const domain = (org?.primary_domain as string) ?? (org?.website_url as string) ?? null;
  return {
    id: String(p.id ?? ""),
    first_name: (p.first_name as string) ?? null,
    last_name: lastName,
    name: (p.name as string) ?? (lastName && p.first_name ? `${p.first_name} ${lastName}` : null),
    title: (p.title as string) ?? null,
    seniority: (p.seniority as string) ?? null,
    linkedin_url: (p.linkedin_url as string) ?? null,
    email: (p.email as string) ?? null,
    email_status: (p.email_status as string) ?? null,
    organization_name: (org?.name as string) ?? ((p.organization_name as string) ?? null),
    organization_domain: domain ? domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : null,
    name_is_partial: partial,
    phone: extractPhone(p),
  };
}

export interface SearchPeopleParams {
  /** Domaine de la société (ex. "acme.com"). Prioritaire sur le nom. */
  domain?: string;
  /** Nom de société si pas de domaine. */
  organizationName?: string;
  /** Mots-clés de titre (ICP), ex. ["RH", "L&D", "People"]. */
  titles?: string[];
  /** Séniorités Apollo, ex. ["director", "vp", "head", "c_suite"]. */
  seniorities?: string[];
  /** Pays/villes, ex. ["France"]. */
  locations?: string[];
  /** Plusieurs domaines d'entreprise (fusionnés avec `domain` dans la même liste). */
  domains?: string[];
  /** Tranches d'effectif Apollo, format "201,500". */
  employeeRanges?: string[];
  /** Localisation du siège de l'entreprise (≠ localisation de la personne). */
  organizationLocations?: string[];
  /** Mots-clés libres (q_keywords). */
  keywords?: string;
  /** Mots-clés secteur de l'entreprise (q_organization_keyword_tags). */
  industryKeywords?: string[];
  /** Élargit aux titres proches (include_similar_titles). */
  includeSimilarTitles?: boolean;
  page?: number;
  perPage?: number;
}

export interface SearchPeopleData {
  people: ApolloPerson[];
  totalEntries: number;
  page: number;
  perPage: number;
  raw: ApolloResult;
}

export async function searchPeople(params: SearchPeopleParams): Promise<SearchPeopleData> {
  const perPage = Math.min(params.perPage ?? 10, 100);
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    per_page: perPage,
  };
  // `domain` et `domains` partagent la même liste : un seul paramètre envoyé.
  const domainList = Array.from(
    new Set([params.domain, ...(params.domains ?? [])].map((d) => (d ?? "").trim().toLowerCase()).filter(Boolean)),
  );
  if (domainList.length) {
    // api_search attend une liste. Ne PAS envoyer aussi q_organization_domains
    // (string) : Apollo rejette les deux ensemble ("cannot be used together").
    body.q_organization_domains_list = domainList;
  }
  if (params.organizationName && !domainList.length) body.q_organization_name = params.organizationName;
  if (params.titles?.length) body.person_titles = params.titles;
  if (params.titles?.length && params.includeSimilarTitles !== undefined) body.include_similar_titles = params.includeSimilarTitles;
  if (params.seniorities?.length) body.person_seniorities = params.seniorities;
  if (params.locations?.length) body.person_locations = params.locations;
  if (params.employeeRanges?.length) body.organization_num_employees_ranges = params.employeeRanges;
  if (params.organizationLocations?.length) body.organization_locations = params.organizationLocations;
  if (params.keywords?.trim()) body.q_keywords = params.keywords.trim();
  if (params.industryKeywords?.length) body.q_organization_keyword_tags = params.industryKeywords;

  // Endpoint API dédié (mixed_people/search est déprécié pour les appels API).
  const res = await apolloFetch<{ people?: Record<string, unknown>[]; pagination?: { total_entries?: number } }>(
    "/mixed_people/api_search",
    body,
  );

  const data = res.data as { people?: Record<string, unknown>[]; pagination?: { total_entries?: number } } | null;
  const people = Array.isArray(data?.people) ? data!.people.map(mapPerson) : [];
  return {
    people,
    totalEntries: data?.pagination?.total_entries ?? people.length,
    page: params.page ?? 1,
    perPage,
    raw: res,
  };
}

export interface RevealPersonParams {
  /** id Apollo issu du search (recommandé). */
  apolloId?: string;
  /** Email connu du contact : matching Apollo le plus fiable (HubSpot contacts). */
  email?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
  organizationName?: string;
}

export interface RevealPersonData {
  person: ApolloPerson | null;
  raw: ApolloResult;
}

export async function revealPerson(params: RevealPersonParams): Promise<RevealPersonData> {
  const body: Record<string, unknown> = {
    reveal_personal_emails: true,
    reveal_phone_number: false,
  };
  if (params.apolloId) body.id = params.apolloId;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.domain) body.domain = params.domain;
  if (params.organizationName) body.organization_name = params.organizationName;

  const res = await apolloFetch<{ person?: Record<string, unknown> }>("/people/match", body);
  const data = res.data as { person?: Record<string, unknown> } | null;
  return {
    person: data?.person ? mapPerson(data.person) : null,
    raw: res,
  };
}

export interface RevealPhoneData {
  person: ApolloPerson | null;
  /** Numéro déjà présent dans la réponse synchrone (fast-path), sinon null. */
  phone: string | null;
  raw: ApolloResult;
}

/**
 * Révèle le NUMÉRO de téléphone d'une personne (People Match,
 * reveal_phone_number). CONSOMME UN CRÉDIT téléphone Apollo.
 *
 * Important : Apollo vérifie le numéro de façon ASYNCHRONE et l'envoie au
 * `webhookUrl` fourni (il n'est en général PAS dans la réponse synchrone). On
 * lit quand même la réponse sync au cas où Apollo renvoie un numéro déjà vérifié
 * dans sa base (fast-path). reveal_personal_emails=false : on ne dépense pas de
 * crédit email, uniquement le crédit téléphone.
 */
export async function revealPhone(
  params: RevealPersonParams,
  webhookUrl?: string,
): Promise<RevealPhoneData> {
  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
    reveal_phone_number: true,
  };
  if (webhookUrl) body.webhook_url = webhookUrl;
  if (params.apolloId) body.id = params.apolloId;
  if (params.email) body.email = params.email;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.domain) body.domain = params.domain;
  if (params.organizationName) body.organization_name = params.organizationName;

  const res = await apolloFetch<{ person?: Record<string, unknown> }>("/people/match", body);
  const data = res.data as { person?: Record<string, unknown> } | null;
  const person = data?.person ? mapPerson(data.person) : null;
  return { person, phone: person?.phone ?? null, raw: res };
}

// Enrichit une personne SANS révéler l'email (pas de crédit email). Sert à
// VALIDER le poste actuel + la société actuelle (People Match renvoie title +
// organization même sans reveal). À utiliser pour les contacts déjà sur HubSpot
// (on ne révèle jamais leur email, cf. règle produit).
export async function matchPerson(params: RevealPersonParams): Promise<RevealPersonData> {
  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  if (params.apolloId) body.id = params.apolloId;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.domain) body.domain = params.domain;
  if (params.organizationName) body.organization_name = params.organizationName;

  const res = await apolloFetch<{ person?: Record<string, unknown> }>("/people/match", body);
  const data = res.data as { person?: Record<string, unknown> } | null;
  return { person: data?.person ? mapPerson(data.person) : null, raw: res };
}

export interface BulkRevealInput {
  /** id Apollo issu du search (matching le plus fiable). */
  apolloId?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
  organizationName?: string;
  linkedinUrl?: string;
}

export interface BulkRevealData {
  /** Même ordre que l'entrée ; null = personne non trouvée par Apollo. */
  people: (ApolloPerson | null)[];
  /** Crédits facturés selon Apollo (null si la réponse ne le précise pas). */
  creditsConsumed: number | null;
  raw: ApolloResult;
}

/** Taille max d'un appel /people/bulk_match (limite Apollo). */
export const BULK_REVEAL_MAX = 10;

/**
 * Révèle l'email PROFESSIONNEL de 1 à 10 personnes (People Bulk Match).
 * CONSOMME UN CRÉDIT email par personne trouvée. On ne révèle jamais d'email
 * personnel (reveal_personal_emails=false) ni de téléphone. Les entrées au-delà
 * de 10 sont ignorées : c'est à l'appelant de découper en paquets.
 */
export async function bulkRevealPeople(people: BulkRevealInput[]): Promise<BulkRevealData> {
  const batch = people.slice(0, BULK_REVEAL_MAX);
  const details = batch.map((p) => {
    const d: Record<string, unknown> = {};
    if (p.apolloId) d.id = p.apolloId;
    if (p.firstName) d.first_name = p.firstName;
    if (p.lastName) d.last_name = p.lastName;
    if (p.firstName && p.lastName) d.name = `${p.firstName} ${p.lastName}`;
    if (p.domain) d.domain = p.domain;
    if (p.organizationName) d.organization_name = p.organizationName;
    if (p.linkedinUrl) d.linkedin_url = p.linkedinUrl;
    return d;
  });
  if (details.length === 0) {
    return { people: [], creditsConsumed: 0, raw: { ok: true, status: 200, ms: 0, data: null, rateLimit: {} } };
  }

  const res = await apolloFetch<{ matches?: (Record<string, unknown> | null)[]; credits_consumed?: number }>("/people/bulk_match", {
    details,
    reveal_personal_emails: false,
    reveal_phone_number: false,
  });
  const data = res.data as { matches?: (Record<string, unknown> | null)[]; credits_consumed?: number } | null;
  const matches = Array.isArray(data?.matches) ? data!.matches : [];
  // Apollo renvoie les matches dans l'ordre des `details` (null si introuvable).
  // Si la longueur diffère (introuvables omis), on réaligne par id Apollo,
  // URL LinkedIn ou prénom + nom pour ne jamais attribuer un email à la
  // mauvaise personne.
  const eq = (a: unknown, b: string | undefined) => typeof a === "string" && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const slug = (u: unknown) => (typeof u === "string" ? (u.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] ?? "").toLowerCase() : "");
  const aligned: (Record<string, unknown> | null)[] =
    matches.length === batch.length
      ? matches
      : batch.map(
          (p) =>
            matches.find(
              (m) =>
                !!m &&
                ((!!p.apolloId && String(m.id ?? "") === p.apolloId) ||
                  (!!p.linkedinUrl && !!slug(p.linkedinUrl) && slug(m.linkedin_url) === slug(p.linkedinUrl)) ||
                  (!p.apolloId && eq(m.first_name, p.firstName) && eq(m.last_name, p.lastName))),
            ) ?? null,
        );
  const out: (ApolloPerson | null)[] = aligned.map((m) => (m && typeof m === "object" ? mapPerson(m) : null));
  const credits = typeof data?.credits_consumed === "number" ? data.credits_consumed : null;
  return { people: out, creditsConsumed: credits, raw: res };
}

export function isApolloConfigured(): boolean {
  return !!APOLLO_API_KEY;
}
