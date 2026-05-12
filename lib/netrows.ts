// ── Netrows API client ──────────────────────────────────────────────────────
// Docs: https://netrows.com/docs
// Base URL: https://api.netrows.com/v1

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

async function netrows<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Netrows ${res.status} ${path}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function netrowsPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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

/** Search people by company + title (1 credit per page) */
export async function searchPeople(params: {
  company?: string;
  keywordTitle?: string;
  keywords?: string;
  firstName?: string;
  lastName?: string;
  start?: number;
}): Promise<{ data: { total: number; items: { fullName: string; headline: string; username: string; location: string; profileURL: string }[] } }> {
  const query: Record<string, string> = {};
  if (params.company) query.company = params.company;
  if (params.keywordTitle) query.keywordTitle = params.keywordTitle;
  if (params.keywords) query.keywords = params.keywords;
  if (params.firstName) query.firstName = params.firstName;
  if (params.lastName) query.lastName = params.lastName;
  if (params.start !== undefined) query.start = String(params.start);
  return netrows("/people/search", query);
}

/** Reverse email lookup — find LinkedIn profile from work email (1 credit) */
export async function reverseLookup(email: string): Promise<{
  found: boolean;
  linkedinUrl: string;
  profile: { fullName: string; headline: string; username: string; profileURL: string };
}> {
  return netrows("/people/reverse-lookup", { email });
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

/** Get company posts (1 credit). Accepts either a LinkedIn username or full URL. */
export async function getCompanyPosts(usernameOrUrl: string, start = 0): Promise<{
  success: boolean;
  data: CompanyPost[];
}> {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://www.linkedin.com/company/${usernameOrUrl}/`;
  return netrows("/companies/posts", { url, start: String(start) });
}

/** Get company job listings (1 credit) */
export async function getCompanyJobs(companyId: string, page = 1): Promise<{
  success: boolean;
  data: { title: string; location: string; postedAt: string; url: string }[];
}> {
  return netrows("/companies/jobs", { companyIds: companyId, page: String(page) });
}

// ── Posts search ─────────────────────────────────────────────────────────────

/** Search LinkedIn posts by keyword (1 credit) */
export async function searchPosts(keyword: string, sortBy = "date_posted", datePosted = ""): Promise<{
  success: boolean;
  data: LinkedInPost[];
}> {
  const params: Record<string, string> = { keyword, sortBy };
  if (datePosted) params.datePosted = datePosted;
  return netrows("/posts/search", params);
}

// ── Radar ────────────────────────────────────────────────────────────────────

/** List monitored companies (free) */
export async function listRadarCompanies(): Promise<{ data: { id: string; username: string; is_active: boolean }[] }> {
  return netrows("/radar/companies");
}

/** Add company to Radar (1 credit one-time, monitoring free forever) */
export async function addCompanyToRadar(username: string): Promise<{ success: boolean }> {
  return netrowsPost("/radar/companies", { username });
}

/** List monitored profiles (free) */
export async function listRadarProfiles(): Promise<{ data: { id: string; username: string; is_active: boolean }[] }> {
  return netrows("/radar/profiles");
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

/** Posts likés par un profil (1 crédit) */
export async function getPeopleLikes(username: string, start = 0): Promise<{
  success: boolean;
  data: { postUrl: string; text: string; author: { name: string; username: string }; postedAt: string; likes: number }[];
}> {
  return netrows("/people/likes", { username, start: String(start) });
}

/** Dernière activité d'un profil (1 crédit) */
export async function getPeopleActivity(username: string): Promise<{
  success: boolean;
  data: { type: string; timestamp: string; postUrl?: string }[];
}> {
  return netrows("/people/activity-time", { username });
}

/** Profils similaires (1 crédit) */
export async function getSimilarProfiles(username: string): Promise<{
  success: boolean;
  data: { fullName: string; headline: string; username: string; profileURL: string }[];
}> {
  return netrows("/people/similar-profiles", { username });
}

/** Recherche entreprises (1 crédit) */
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
  return netrows("/companies/search", query);
}

/** Insights premium d'une entreprise (10 crédits) */
export async function getCompanyInsights(username: string): Promise<{
  success: boolean;
  data: { headcountGrowth: number; turnover: number; openings: number };
}> {
  return netrows("/companies/insights", { username });
}

/** Pubs LinkedIn actives d'une entreprise (1 crédit) */
export async function getCompanyAds(username: string): Promise<{
  success: boolean;
  data: { adUrl: string; text: string; mediaUrl?: string; postedAt: string }[];
}> {
  return netrows("/ads/company", { username });
}

/** Réactions à un post (1 crédit) */
export async function getPostReactions(postUrl: string, start = 0): Promise<{
  success: boolean;
  data: { fullName: string; headline: string; username: string; reaction: string }[];
}> {
  return netrows("/posts/reactions", { postUrl, start: String(start) });
}

/** Email pro à partir d'un profil LinkedIn (5 crédits) — sans cache. */
export async function findEmailByLinkedIn(username: string): Promise<{
  success: boolean;
  data: { email: string | null; confidence: "high" | "medium" | "low" | null };
}> {
  return netrows("/email-finder/by-linkedin", { username });
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

/** Email du décideur RH/L&D d'une entreprise (10 crédits) */
export async function findDecisionMakerEmail(params: {
  company: string;
  title: string;
}): Promise<{
  success: boolean;
  data: { email: string | null; fullName: string | null; profileUrl: string | null };
}> {
  return netrows("/email-finder/decision-maker", {
    company: params.company,
    title: params.title,
  });
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
