/**
 * Client Apollo.io — testbed.
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
  const error = res.ok ? undefined : ((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return { ok: res.ok, status: res.status, ms, data, rateLimit, error };
}

function mapPerson(p: Record<string, unknown>): ApolloPerson {
  const org = (p.organization as Record<string, unknown> | null) ?? null;
  return {
    id: String(p.id ?? ""),
    first_name: (p.first_name as string) ?? null,
    last_name: (p.last_name as string) ?? null,
    name: (p.name as string) ?? null,
    title: (p.title as string) ?? null,
    seniority: (p.seniority as string) ?? null,
    linkedin_url: (p.linkedin_url as string) ?? null,
    email: (p.email as string) ?? null,
    email_status: (p.email_status as string) ?? null,
    organization_name: (org?.name as string) ?? ((p.organization_name as string) ?? null),
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
  if (params.domain) {
    // api_search attend une liste. Ne PAS envoyer aussi q_organization_domains
    // (string) : Apollo rejette les deux ensemble ("cannot be used together").
    body.q_organization_domains_list = [params.domain];
  }
  if (params.organizationName && !params.domain) body.q_organization_name = params.organizationName;
  if (params.titles?.length) body.person_titles = params.titles;
  if (params.seniorities?.length) body.person_seniorities = params.seniorities;
  if (params.locations?.length) body.person_locations = params.locations;

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

export function isApolloConfigured(): boolean {
  return !!APOLLO_API_KEY;
}
