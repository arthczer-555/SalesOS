/**
 * Adaptateur LinkedIn Bright Data :
 *  - recherche (people / companies / posts) → SERP API Google (synchrone)
 *  - fiches détaillées (profil / entreprise / posts / jobs / activité) → datasets
 *    Web Scraper (asynchrone, best-effort avec timeout)
 *
 * Email finder, reverse-lookup, similar-profiles, post-reactions, company
 * insights : PAS d'équivalent Bright Data → retirés.
 * La découverte d'email s'appuie désormais sur les emails déjà en CRM HubSpot.
 */

import { fetchSerp } from "./serp";
import { DATASETS, collectAndWait } from "./dataset";
import { slugifyCompany } from "../slugify-company";

export { slugifyCompany };

// ── Types ───────────────────────────────────────────────────────────────────

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

export interface CompanyPost {
  postUrl: string;
  text: string;
  postedAt: string;
  likes: number;
  comments: number;
}

export interface PeopleSearchItem {
  fullName: string;
  headline: string;
  username: string;
  location: string;
  profileURL: string;
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

function profileSlug(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function companySlug(url: string): string {
  const m = url.match(/\/company\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

/** "Thomas Czernichow - Managing Partner, ALEIA | LinkedIn" → {name, headline} */
function splitTitle(title: string): { name: string; headline: string } {
  const clean = title.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const idx = clean.indexOf(" - ");
  if (idx === -1) return { name: clean, headline: "" };
  return { name: clean.slice(0, idx).trim(), headline: clean.slice(idx + 3).trim() };
}

type OrganicResult = { link?: string; url?: string; title?: string; description?: string };

/** Lance une requête Google via la SERP API et renvoie les résultats organiques. */
async function serpOrganic(query: string, num = 20): Promise<OrganicResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1&num=${num}`;
  const r = await fetchSerp(url);
  if (!r.isJson || !r.ok) return [];
  const data = r.data as { organic?: OrganicResult[] };
  return data.organic ?? [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num0(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mots génériques ignorés pour isoler le token distinctif d'une société.
const COMPANY_STOPWORDS = new Set([
  "the", "and", "les", "des", "sas", "sarl", "sa", "group", "groupe",
  "co", "inc", "ltd", "llc", "company", "international", "france", "global",
]);

// Score d'évocation de la société dans le texte (titre + snippet) :
//   2 = société complète normalisée présente ("allianz trade")
//   1 = seulement le token distinctif (le plus long hors mots génériques) ("allianz")
//   0 = rien
// Permet de privilégier "Allianz Trade" sur un simple "Allianz" (maison-mère).
function companyScore(haystack: string, company: string): 0 | 1 | 2 {
  const cn = normalize(company);
  if (!cn) return 0;
  if (haystack.includes(cn)) return 2;
  const key = cn
    .split(" ")
    .filter((t) => t.length >= 3 && !COMPANY_STOPWORDS.has(t))
    .sort((a, b) => b.length - a.length)[0];
  return key && haystack.includes(key) ? 1 : 0;
}

// ── People : recherche (SERP, synchrone) ────────────────────────────────────

/**
 * Recherche de profils par critères (SERP Google).
 * Implémenté via Google `site:linkedin.com/in`. Renvoie la même shape.
 */
export async function searchPeople(params: {
  company?: string;
  keywordTitle?: string;
  keywords?: string;
  firstName?: string;
  lastName?: string;
  geo?: string;
  start?: number;
}): Promise<{ data: { total: number; items: PeopleSearchItem[] } }> {
  const terms = [
    params.firstName,
    params.lastName,
    params.keywordTitle,
    params.keywords,
    params.company,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!terms) return { data: { total: 0, items: [] } };

  const organic = await serpOrganic(`${terms} site:linkedin.com/in`);
  const seen = new Set<string>();
  const company = params.company?.trim() ?? "";
  const fn = normalize(params.firstName ?? "");
  const ln = normalize(params.lastName ?? "");
  const isPersonLookup = !!(fn || ln);

  type Scored = PeopleSearchItem & { nameHit: boolean; coScore: 0 | 1 | 2 };
  const all: Scored[] = [];
  for (const o of organic) {
    const url = o.link || o.url || "";
    if (!/linkedin\.com\/in\//i.test(url)) continue;
    const slug = profileSlug(url);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const { name, headline } = splitTitle(str(o.title));
    // slug inclus dans le foin : le nom apparaît souvent dans l'URL (audrey-le-bris).
    const hay = normalize(`${slug} ${str(o.title)} ${str(o.description)}`);
    all.push({
      fullName: name,
      headline: headline || str(o.description).slice(0, 120),
      username: slug,
      location: "",
      profileURL: url,
      // LinkedIn tronque souvent le nom ("Audrey L.") → on teste prénom OU nom.
      nameHit: (!!fn && hay.includes(fn)) || (!!ln && hay.includes(ln)),
      coScore: company ? companyScore(hay, company) : 0,
    });
  }

  // Garde la société complète prioritaire sur le token seul ("Allianz Trade" > "Allianz").
  const keepBestCompany = (pool: Scored[]): Scored[] => {
    if (!company) return pool;
    const full = pool.filter((c) => c.coScore === 2);
    if (full.length > 0) return full;
    const token = pool.filter((c) => c.coScore >= 1);
    return token.length > 0 ? token : pool;
  };

  // Réduction du plus précis au plus large :
  // - personne (prénom/nom) : on garde d'abord ceux dont le nom matche, puis on
  //   resserre sur la société (complète > token). prénom + société isole le bon
  //   profil même nom tronqué (homonymes de la même boîte / maison-mère écartés).
  // - société/poste seule : on resserre sur la société.
  // Si un filtre vide le set, on retombe sur l'étape précédente (jamais 0 par filtre).
  let kept: Scored[];
  if (isPersonLookup) {
    const byName = all.filter((c) => c.nameHit);
    kept = keepBestCompany(byName.length > 0 ? byName : all);
  } else {
    kept = keepBestCompany(all);
  }

  const items: PeopleSearchItem[] = kept.map(
    ({ nameHit, coScore, ...c }) => { void nameHit; void coScore; return c; },
  );
  return { data: { total: items.length, items } };
}

/**
 * Résout un username LinkedIn depuis (firstName + lastName + company) ou email.
 * Réutilise le cache DB `linkedin_username_cache` (sans le chemin reverse-lookup
 * email, indisponible chez Bright Data).
 */
export async function resolveUsername(params: {
  username?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
}): Promise<string | null> {
  if (params.username) return params.username;
  if (!params.firstName || !params.lastName) return null;

  const { db } = await import("@/lib/db");
  const c = (params.company ?? "").trim().toLowerCase();
  const key = `name:${params.firstName.trim().toLowerCase()}|${params.lastName.trim().toLowerCase()}|${c}`;

  const { data: cached } = await db
    .from("linkedin_username_cache")
    .select("username, resolved_at")
    .eq("lookup_key", key)
    .maybeSingle();
  if (cached) {
    if (cached.username) return cached.username as string;
    const resolvedAt = cached.resolved_at ? new Date(cached.resolved_at).getTime() : 0;
    if (resolvedAt > Date.now() - 30 * 86_400_000) return null; // negative hit récent
  }

  const r = await searchPeople({
    firstName: params.firstName,
    lastName: params.lastName,
    company: params.company,
  });
  const resolved = r.data.items[0]?.username ?? null;

  try {
    await db
      .from("linkedin_username_cache")
      .upsert(
        { lookup_key: key, username: resolved, resolved_at: new Date().toISOString() },
        { onConflict: "lookup_key" },
      );
  } catch {
    /* cache best-effort */
  }
  return resolved;
}

// ── People : fiche détaillée (dataset, async best-effort) ───────────────────

export function mapProfile(raw: Record<string, unknown>): LinkedInProfile {
  const url = str(raw.url || raw.input_url);
  const name = str(raw.name);
  const first = str(raw.first_name) || name.split(" ")[0] || "";
  const last = str(raw.last_name) || name.split(" ").slice(1).join(" ") || "";
  const cc = raw.current_company as Record<string, unknown> | undefined;

  const experience = Array.isArray(raw.experience) ? (raw.experience as Record<string, unknown>[]) : [];
  const education = Array.isArray(raw.education) ? (raw.education as Record<string, unknown>[]) : [];

  return {
    id: 0,
    username: profileSlug(url) || str(raw.id),
    firstName: first,
    lastName: last,
    headline: str(raw.position || raw.headline || (cc && cc.title)),
    summary: str(raw.about || raw.summary),
    profilePicture: str(raw.avatar || raw.profile_pic_url),
    geo: {
      country: str(raw.country_code),
      city: str(raw.city || raw.location),
      countryCode: str(raw.country_code),
    },
    position: experience.map((e) => ({
      companyName: str(e.company || e.company_name),
      companyUsername: companySlug(str(e.url || e.company_url)),
      title: str(e.title),
      location: str(e.location),
      description: str(e.description),
      start: { year: 0, month: 0 },
      end: { year: 0, month: 0 },
    })),
    educations: education.map((e) => ({
      schoolName: str(e.title || e.school || e.institute),
      degree: str(e.degree),
      fieldOfStudy: str(e.field || e.field_of_study),
    })),
    skills: [],
  };
}

/** Fiche profil par username (best-effort, async). Throw si rien à temps. */
export async function getProfile(username: string, opts: { timeoutMs?: number } = {}): Promise<LinkedInProfile> {
  const url = username.startsWith("http")
    ? username
    : `https://www.linkedin.com/in/${username}/`;
  return getProfileByUrl(url, opts);
}

/** Fiche profil par URL (best-effort, async). Throw si rien à temps. */
export async function getProfileByUrl(url: string, opts: { timeoutMs?: number } = {}): Promise<LinkedInProfile> {
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.peopleProfile,
    [{ url }],
    { timeoutMs: opts.timeoutMs ?? 20_000 },
  );
  if (!rows.length) throw new Error("Profil LinkedIn non disponible (scrape trop lent ou introuvable)");
  return mapProfile(rows[0]);
}

// ── Companies ───────────────────────────────────────────────────────────────

/** Détails entreprise (best-effort, async via dataset). */
export async function getCompanyDetails(usernameOrUrl: string, opts: { timeoutMs?: number } = {}): Promise<{
  name: string; description: string; website: string; industry: string;
  companySize: string; headquarters: string; employeeCount: number;
  followerCount: number; founded: number;
}> {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://www.linkedin.com/company/${usernameOrUrl}/`;
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.companyInfo,
    [{ url }],
    { timeoutMs: opts.timeoutMs ?? 20_000 },
  );
  const r = rows[0] ?? {};
  const industries = r.industries;
  return {
    name: str(r.name),
    description: str(r.description || r.about),
    website: str(r.website || r.website_simplified),
    industry: Array.isArray(industries) ? industries.map(str).join(", ") : str(industries),
    companySize: str(r.company_size),
    headquarters: str(r.headquarters),
    employeeCount: num0(r.employees ?? r.employees_in_linkedin),
    followerCount: num0(r.followers),
    founded: num0(r.founded),
  };
}

/** Posts récents d'une entreprise (best-effort, async). Renvoie `[]` si rien. */
export async function getCompanyPosts(usernameOrUrl: string, opts: { timeoutMs?: number } = {}): Promise<{
  success: boolean;
  data: CompanyPost[];
}> {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://www.linkedin.com/company/${usernameOrUrl}/`;
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.posts,
    [{ url }],
    {
      timeoutMs: opts.timeoutMs ?? 25_000,
      // 10 posts suffisent partout (l'appelant le plus gourmand en garde 8) et
      // on ne paie que ce qu'on lit. Cf. `limitPerInput` dans dataset.ts.
      discover: { type: "discover_new", discoverBy: "company_url", limitPerInput: 10 },
    },
  );
  const data: CompanyPost[] = rows.map((r) => ({
    postUrl: str(r.url),
    text: str(r.post_text || r.title || r.headline),
    postedAt: str(r.date_posted),
    likes: num0(r.num_likes),
    comments: num0(r.num_comments),
  }));
  return { success: true, data };
}

/** Offres d'emploi d'une entreprise (best-effort, async). Discover by keyword. */
export async function getCompanyJobs(companyNameOrUrl: string, opts: { timeoutMs?: number } = {}): Promise<{
  success: boolean;
  data: { title: string; location: string; postedAt: string; url: string }[];
}> {
  const isUrl = companyNameOrUrl.startsWith("http");
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.jobs,
    [isUrl ? { url: companyNameOrUrl } : { keyword: companyNameOrUrl }],
    {
      timeoutMs: opts.timeoutMs ?? 25_000,
      // Une découverte par mot-clé remonte sinon TOUTES les offres de la boîte,
      // toutes facturées, alors que l'appelant en garde 10.
      discover: { type: "discover_new", discoverBy: isUrl ? "url" : "keyword", limitPerInput: 10 },
    },
  );
  const data = rows.map((r) => ({
    title: str(r.job_title || r.title),
    location: str(r.job_location || r.location),
    postedAt: str(r.job_posted_date || r.date_posted),
    url: str(r.url || r.job_url),
  }));
  return { success: true, data };
}

/**
 * Posts personnels récents d'un profil, avec leur texte (best-effort, async).
 * Même dataset que getCompanyPosts mais découverte par profile_url, et on garde
 * le texte du post (getPeopleActivity ne renvoie que le timestamp + l'URL).
 */
export async function getPeoplePosts(usernameOrUrl: string, opts: { timeoutMs?: number } = {}): Promise<{
  success: boolean;
  data: CompanyPost[];
}> {
  const url = usernameOrUrl.startsWith("http")
    ? usernameOrUrl
    : `https://www.linkedin.com/in/${usernameOrUrl}/`;
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.posts,
    [{ url }],
    {
      timeoutMs: opts.timeoutMs ?? 25_000,
      discover: { type: "discover_new", discoverBy: "profile_url", limitPerInput: 10 },
    },
  );
  const data: CompanyPost[] = rows.map((r) => ({
    postUrl: str(r.url),
    text: str(r.post_text || r.title || r.headline),
    postedAt: str(r.date_posted),
    likes: num0(r.num_likes),
    comments: num0(r.num_comments),
  }));
  return { success: true, data };
}

/** Activité récente d'un profil = ses posts (best-effort, async). */
export async function getPeopleActivity(username: string, opts: { timeoutMs?: number } = {}): Promise<{
  success: boolean;
  data: { type: string; timestamp: string; postUrl?: string }[];
}> {
  const url = username.startsWith("http")
    ? username
    : `https://www.linkedin.com/in/${username}/`;
  const rows = await collectAndWait<Record<string, unknown>>(
    DATASETS.posts,
    [{ url }],
    {
      timeoutMs: opts.timeoutMs ?? 25_000,
      discover: { type: "discover_new", discoverBy: "profile_url", limitPerInput: 10 },
    },
  );
  const data = rows.map((r) => ({
    type: "post",
    timestamp: str(r.date_posted),
    postUrl: str(r.url),
  }));
  return { success: true, data };
}

/** Recherche d'entreprises (SERP, synchrone). */
export async function searchCompanies(params: {
  keyword: string;
  industry?: string;
  size?: string;
  start?: number;
}): Promise<{ data: { items: { name: string; username: string; industry: string; size: string; companyURL: string }[] } }> {
  if (!params.keyword?.trim()) return { data: { items: [] } };
  const organic = await serpOrganic(`${params.keyword} site:linkedin.com/company`);
  const seen = new Set<string>();
  const items = [];
  for (const o of organic) {
    const url = o.link || o.url || "";
    if (!/linkedin\.com\/company\//i.test(url)) continue;
    const slug = companySlug(url);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const { name } = splitTitle(str(o.title));
    items.push({ name, username: slug, industry: "", size: "", companyURL: url });
  }
  return { data: { items } };
}
