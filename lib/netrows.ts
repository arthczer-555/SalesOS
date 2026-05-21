// ── Netrows API client ──────────────────────────────────────────────────────
// Docs: https://netrows.com/docs
// Base URL: https://api.netrows.com/v1

import { sanitizeNetrowsParam } from "@/lib/intel/netrows-sanitize";

const BASE = "https://api.netrows.com/v1";

/**
 * Convertit un nom d'entreprise en username LinkedIn plausible.
 * Gère les accents ("Crédit Agricole" → "credit-agricole"), apostrophes
 * ("L'Oréal" → "l-oreal"), espaces multiples, et symboles.
 *
 * ⚠️ Heuristique : le vrai slug LinkedIn peut différer (ex: "totalenergies").
 * À utiliser comme fallback quand on n'a pas le vrai username.
 */
export function slugifyCompany(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getApiKey(): string {
  const key = process.env.NETROWS_API_KEY;
  if (!key) throw new Error("NETROWS_API_KEY not set");
  return key;
}

/**
 * Netrows renvoie un 404 avec `{code: "NOT_FOUND"}` quand une recherche
 * ne ramène aucun résultat. C'est une réponse normale, pas une erreur.
 * On l'attrape via cette classe pour que les wrappers de listes la
 * convertissent en `[]` au lieu de propager une exception.
 */
export class NetrowsNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Netrows 404 ${path}: no results`);
    this.name = "NetrowsNotFoundError";
  }
}

/** 401 Invalid API key. Bloquant, à corriger côté env. */
export class NetrowsAuthError extends Error {
  constructor(public readonly path: string) {
    super(`Netrows 401 ${path}: clé API invalide ou révoquée`);
    this.name = "NetrowsAuthError";
  }
}

/** 402 Insufficient credits. Bloquant tant que crédits pas rechargés. */
export class NetrowsCreditsError extends Error {
  constructor(public readonly path: string) {
    super(`Netrows 402 ${path}: crédits insuffisants`);
    this.name = "NetrowsCreditsError";
  }
}

/** 429 Rate limit exceeded. Réessayer dans ~1 min. */
export class NetrowsRateLimitError extends Error {
  constructor(public readonly path: string) {
    super(`Netrows 429 ${path}: rate-limit atteint, réessayez dans ~1min`);
    this.name = "NetrowsRateLimitError";
  }
}

// Sans ce timeout, un fetch qui hang bloque l'appelant jusqu'à la
// kill-fence Netlify (15min sur Background Functions).
const NETROWS_TIMEOUT_MS = 25_000;

export class NetrowsTimeoutError extends Error {
  constructor(public readonly path: string) {
    super(`Netrows ${path}: pas de réponse après ${NETROWS_TIMEOUT_MS}ms`);
    this.name = "NetrowsTimeoutError";
  }
}

function isAbortTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

async function netrows<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: AbortSignal.timeout(NETROWS_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortTimeout(e)) throw new NetrowsTimeoutError(path);
    throw e;
  }

  if (res.status === 401) {
    await res.text().catch(() => "");
    throw new NetrowsAuthError(path);
  }
  if (res.status === 402) {
    await res.text().catch(() => "");
    throw new NetrowsCreditsError(path);
  }
  if (res.status === 404) {
    // Drain the body so the connection can be reused.
    await res.text().catch(() => "");
    throw new NetrowsNotFoundError(path);
  }
  if (res.status === 429) {
    await res.text().catch(() => "");
    throw new NetrowsRateLimitError(path);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Netrows ${res.status} ${path}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function netrowsPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(NETROWS_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortTimeout(e)) throw new NetrowsTimeoutError(path);
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Netrows POST ${res.status} ${path}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInProfile {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  headline: string;
  summary: string;
  profilePicture: string;
  geo: { country: string; city: string; countryCode: string };
  position: {
    companyName: string;
    companyUsername: string;
    title: string;
    location: string;
    description: string;
    start: { year: number; month: number };
    end: { year: number; month: number };
  }[];
  educations: { schoolName: string; degree: string; fieldOfStudy: string }[];
  skills: { name: string }[];
}

export interface LinkedInPost {
  postUrl: string;
  text: string;
  author: { name: string; headline: string; username: string; profileUrl: string };
  postedAt: string;
  likes: number;
  comments: number;
  shares: number;
}

export interface CompanyPost {
  postUrl: string;
  text: string;
  postedAt: string;
  likes: number;
  comments: number;
}

export interface RadarWebhookPayload {
  event: "profile.changed" | "company.changed";
  timestamp: string;
  profile?: { username: string; url: string };
  company?: { username: string; url: string };
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  summary: string;
  newSnapshot: Record<string, unknown>;
}

// ── People ───────────────────────────────────────────────────────────────────

/** Get full LinkedIn profile by username (1 credit) */
export async function getProfile(username: string): Promise<LinkedInProfile> {
  return netrows<LinkedInProfile>("/people/profile", { username });
}

/** Get full LinkedIn profile by URL (1 credit) */
export async function getProfileByUrl(url: string): Promise<LinkedInProfile> {
  return netrows<LinkedInProfile>("/people/profile-by-url", { url });
}

/** Search people (1 credit per page, jusqu'à 10 profils/page). Returns `{ total: 0, items: [] }` if no match. */
export async function searchPeople(params: {
  company?: string;
  keywordTitle?: string;
  keywords?: string;
  firstName?: string;
  lastName?: string;
  geo?: string;
  schoolId?: string;
  keywordSchool?: string;
  start?: number;
}): Promise<{ data: { total: number; items: { fullName: string; headline: string; username: string; location: string; profileURL: string }[] } }> {
  const query: Record<string, string> = {};
  // Tous les params texte passent par sanitizeNetrowsParam : Netrows 404 silencieusement
  // sur les caractères spéciaux (), {}, /, ',', ', ", &). Cf lib/intel/netrows-sanitize.
  const clean = (v: string) => sanitizeNetrowsParam(v);
  if (params.company) query.company = clean(params.company);
  if (params.keywordTitle) query.keywordTitle = clean(params.keywordTitle);
  if (params.keywords) query.keywords = clean(params.keywords);
  if (params.firstName) query.firstName = clean(params.firstName);
  if (params.lastName) query.lastName = clean(params.lastName);
  if (params.geo) query.geo = params.geo; // ID numérique, pas de sanitize
  if (params.schoolId) query.schoolId = params.schoolId;
  if (params.keywordSchool) query.keywordSchool = clean(params.keywordSchool);
  if (params.start !== undefined) query.start = String(params.start);
  try {
    return await netrows("/people/search", query);
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { data: { total: 0, items: [] } };
    throw e;
  }
}

/**
 * Search LinkedIn locations to resolve a city name into a geo ID (free, pas
 * de crédit). Renvoie `{ id, name }` où `id` est un URN type
 * `urn:li:geo:106383538`. On extrait juste la partie numérique pour la passer
 * à `searchPeople({ geo })`.
 */
export async function searchLocations(keyword: string): Promise<{ id: string; name: string }[]> {
  try {
    const r = await netrows<{ data: { items: { id: string; name: string }[] } }>(
      "/locations/search",
      { keyword }
    );
    return r.data?.items ?? [];
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return [];
    throw e;
  }
}

export function extractGeoId(urn: string): string {
  const m = urn.match(/(\d+)$/);
  return m ? m[1] : urn;
}

/** Reverse email lookup — find LinkedIn profile from work email (1 credit). Renvoie `found:false` si introuvable. */
export async function reverseLookup(email: string): Promise<{
  found: boolean;
  linkedinUrl: string;
  profile: { fullName: string; headline: string; username: string; profileURL: string };
}> {
  try {
    return await netrows("/people/reverse-lookup", { email });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) {
      return { found: false, linkedinUrl: "", profile: { fullName: "", headline: "", username: "", profileURL: "" } };
    }
    throw e;
  }
}

// ── Companies ────────────────────────────────────────────────────────────────

/** Get company details (1 credit) */
export async function getCompanyDetails(username: string): Promise<{
  name: string; description: string; website: string; industry: string;
  companySize: string; headquarters: string; employeeCount: number;
  followerCount: number; founded: number;
}> {
  return netrows("/companies/details", { username });
}

/** Get company posts (1 credit). Accepts either a LinkedIn username or full URL. Returns `[]` if none. */
export async function getCompanyPosts(usernameOrUrl: string, start = 0): Promise<{
  success: boolean;
  data: CompanyPost[];
}> {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://www.linkedin.com/company/${usernameOrUrl}/`;
  try {
    return await netrows("/companies/posts", { url, start: String(start) });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Get company job listings (1 credit). Returns `[]` if no openings. */
export async function getCompanyJobs(companyId: string, page = 1): Promise<{
  success: boolean;
  data: { title: string; location: string; postedAt: string; url: string }[];
}> {
  try {
    return await netrows("/companies/jobs", { companyIds: companyId, page: String(page) });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

// ── Posts search ─────────────────────────────────────────────────────────────

/** Search LinkedIn posts by keyword (1 credit). Returns `[]` if no match. */
export async function searchPosts(keyword: string, sortBy = "date_posted", datePosted = ""): Promise<{
  success: boolean;
  data: LinkedInPost[];
}> {
  const params: Record<string, string> = { keyword, sortBy };
  if (datePosted) params.datePosted = datePosted;
  try {
    return await netrows("/posts/search", params);
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

// ── Radar ────────────────────────────────────────────────────────────────────

/** List monitored companies (free). Renvoie `[]` si rien n'est encore monitoré. */
export async function listRadarCompanies(): Promise<{ data: { id: string; username: string; is_active: boolean }[] }> {
  try {
    return await netrows("/radar/companies");
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { data: [] };
    throw e;
  }
}

/** Add company to Radar (1 credit one-time, monitoring free forever) */
export async function addCompanyToRadar(username: string): Promise<{ success: boolean }> {
  return netrowsPost("/radar/companies", { username });
}

/** List monitored profiles (free). Renvoie `[]` si rien n'est encore monitoré. */
export async function listRadarProfiles(): Promise<{ data: { id: string; username: string; is_active: boolean }[] }> {
  try {
    return await netrows("/radar/profiles");
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { data: [] };
    throw e;
  }
}

/** Add profile to Radar (1 credit one-time) */
export async function addProfileToRadar(username: string): Promise<{ success: boolean }> {
  return netrowsPost("/radar/profiles", { username });
}

// ── Config — mots-clés pour le scan ─────────────────────────────────────────

/** Mots-clés pour détecter les changements de poste dans les posts LinkedIn */
export const JOB_CHANGE_KEYWORDS = [
  "ravi de rejoindre",
  "nouvelle aventure",
  "nouveau challenge",
  "nouveau poste",
  "je suis heureux d'annoncer",
  "thrilled to join",
  "excited to announce",
  "new role",
  "nouveau chapitre",
  "nommé DRH",
  "nommé Head of",
  "nommée Directrice",
];

/** Mots-clés pour détecter les posts coaching/L&D */
export const COACHING_KEYWORDS = [
  "coaching managers",
  "coaching leadership",
  "développement managérial",
  "formation managers",
  "talent development",
  "learning development",
  "coaching professionnel",
  "leadership development",
  "coaching équipe",
  "développement leadership",
  "onboarding managers",
  "executive coaching",
  "rétention talents",
  "engagement collaborateurs",
  "qualité vie travail",
];

// ── Wrappers additionnels (Market Intel v2) ─────────────────────────────────

/** Posts likés par un profil (1 crédit). Renvoie `[]` si pas de likes. */
export async function getPeopleLikes(username: string, start = 0): Promise<{
  success: boolean;
  data: { postUrl: string; text: string; author: { name: string; username: string }; postedAt: string; likes: number }[];
}> {
  try {
    return await netrows("/people/likes", { username, start: String(start) });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Dernière activité d'un profil (1 crédit). Renvoie `[]` si pas d'activité. */
export async function getPeopleActivity(username: string): Promise<{
  success: boolean;
  data: { type: string; timestamp: string; postUrl?: string }[];
}> {
  try {
    return await netrows("/people/activity-time", { username });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Profils similaires (1 crédit). Renvoie `[]` si aucun. */
export async function getSimilarProfiles(username: string): Promise<{
  success: boolean;
  data: { fullName: string; headline: string; username: string; profileURL: string }[];
}> {
  try {
    return await netrows("/people/similar-profiles", { username });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Recherche entreprises (1 crédit). Renvoie `[]` si pas de match. */
export async function searchCompanies(params: {
  keyword: string;
  industry?: string;
  size?: string;
  start?: number;
}): Promise<{
  data: { items: { name: string; username: string; industry: string; size: string; companyURL: string }[] };
}> {
  const query: Record<string, string> = { keyword: params.keyword };
  if (params.industry) query.industry = params.industry;
  if (params.size) query.size = params.size;
  if (params.start !== undefined) query.start = String(params.start);
  try {
    return await netrows("/companies/search", query);
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { data: { items: [] } };
    throw e;
  }
}

/** Insights premium d'une entreprise (10 crédits) */
export async function getCompanyInsights(username: string): Promise<{
  success: boolean;
  data: { headcountGrowth: number; turnover: number; openings: number };
}> {
  return netrows("/companies/insights", { username });
}

/** Pubs LinkedIn actives d'une entreprise (1 crédit). Renvoie `[]` si pas de pub active. */
export async function getCompanyAds(username: string): Promise<{
  success: boolean;
  data: { adUrl: string; text: string; mediaUrl?: string; postedAt: string }[];
}> {
  try {
    return await netrows("/ads/company", { username });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Réactions à un post (1 crédit). Renvoie `[]` si aucune. */
export async function getPostReactions(postUrl: string, start = 0): Promise<{
  success: boolean;
  data: { fullName: string; headline: string; username: string; reaction: string }[];
}> {
  try {
    return await netrows("/posts/reactions", { postUrl, start: String(start) });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: true, data: [] };
    throw e;
  }
}

/** Email pro à partir d'un profil LinkedIn (5 crédits) - sans cache. Renvoie `null` si pas d'email.
 * L'API attend `linkedin_url`, donc on reconstruit l'URL canonique depuis le username.
 */
export async function findEmailByLinkedIn(username: string): Promise<{
  success: boolean;
  data: { email: string | null; confidence: "high" | "medium" | "low" | null };
}> {
  const linkedin_url = username.startsWith("http")
    ? username
    : `https://www.linkedin.com/in/${username}`;
  try {
    return await netrows("/email-finder/by-linkedin", { linkedin_url });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) return { success: false, data: { email: null, confidence: null } };
    throw e;
  }
}

/**
 * Variante cachée 30 jours. Stocke aussi les misses (email=null) pour
 * éviter de repayer 5 crédits sur les mêmes profils introuvables.
 */
export async function findEmailByLinkedInCached(username: string): Promise<{
  email: string | null;
  confidence: "high" | "medium" | "low" | null;
  cached: boolean;
}> {
  const { db } = await import("@/lib/db");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: cached } = await db
    .from("linkedin_email_cache")
    .select("email, confidence, resolved_at")
    .eq("username", username)
    .gte("resolved_at", thirtyDaysAgo)
    .maybeSingle();

  if (cached) {
    return {
      email: cached.email as string | null,
      confidence: cached.confidence as "high" | "medium" | "low" | null,
      cached: true,
    };
  }

  const result = await findEmailByLinkedIn(username);
  const email = result.data?.email ?? null;
  const confidence = result.data?.confidence ?? null;

  try {
    await db.from("linkedin_email_cache").upsert(
      { username, email, confidence, resolved_at: new Date().toISOString() },
      { onConflict: "username" }
    );
  } catch {
    /* cache best-effort */
  }

  return { email, confidence, cached: false };
}

/** Email du décideur RH/L&D d'une entreprise (10 crédits). Renvoie `null` si pas de décideur trouvé. */
export async function findDecisionMakerEmail(params: {
  company: string;
  title: string;
}): Promise<{
  success: boolean;
  data: { email: string | null; fullName: string | null; profileUrl: string | null };
}> {
  try {
    return await netrows("/email-finder/decision-maker", {
      company: params.company,
      title: params.title,
    });
  } catch (e) {
    if (e instanceof NetrowsNotFoundError) {
      return { success: false, data: { email: null, fullName: null, profileUrl: null } };
    }
    throw e;
  }
}

// ── Username resolution (fallback nom/prénom + cache DB) ────────────────────

const GENERIC_EMAIL_DOMAINS = /@(gmail|yahoo|hotmail|outlook|icloud|live|aol|protonmail)\./i;

function emailIsPro(email: string | null | undefined): boolean {
  if (!email) return false;
  return !GENERIC_EMAIL_DOMAINS.test(email);
}

function lookupKey(params: { firstName?: string; lastName?: string; company?: string; email?: string }): string | null {
  if (params.email) return `email:${params.email.trim().toLowerCase()}`;
  if (params.firstName && params.lastName) {
    const c = (params.company ?? "").trim().toLowerCase();
    return `name:${params.firstName.trim().toLowerCase()}|${params.lastName.trim().toLowerCase()}|${c}`;
  }
  return null;
}

/**
 * Résout un username LinkedIn depuis email OU (firstName + lastName + company).
 * Utilise le cache DB linkedin_username_cache pour éviter les appels répétés.
 *
 * Coût : 0 (cache hit) → 1 (reverseLookup) → 2 (reverseLookup miss + searchPeople)
 */
export async function resolveUsername(params: {
  username?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
}): Promise<string | null> {
  if (params.username) return params.username;

  const { db } = await import("@/lib/db");
  const key = lookupKey(params);

  if (key) {
    const { data: cached } = await db
      .from("linkedin_username_cache")
      .select("username, resolved_at")
      .eq("lookup_key", key)
      .maybeSingle();
    if (cached) {
      if (cached.username) return cached.username as string;
      // Negative hit: don't retry the API if we tried recently.
      const resolvedAt = cached.resolved_at ? new Date(cached.resolved_at).getTime() : 0;
      const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
      if (resolvedAt > thirtyDaysAgo) return null;
    }
  }

  let resolved: string | null = null;

  if (emailIsPro(params.email)) {
    try {
      const r = await reverseLookup(params.email!);
      if (r.found && r.profile?.username) resolved = r.profile.username;
    } catch {
      /* fall through */
    }
  }

  if (!resolved && params.firstName && params.lastName) {
    try {
      const r = await searchPeople({
        firstName: params.firstName,
        lastName: params.lastName,
        company: params.company,
      });
      const first = r.data?.items?.[0];
      if (first?.username) resolved = first.username;
    } catch {
      /* nothing else to try */
    }
  }

  if (key) {
    // Cache both hits and misses — misses are checked above with a 30-day TTL.
    try {
      await db
        .from("linkedin_username_cache")
        .upsert(
          { lookup_key: key, username: resolved, resolved_at: new Date().toISOString() },
          { onConflict: "lookup_key" }
        );
    } catch {
      /* cache best-effort */
    }
  }

  return resolved;
}
