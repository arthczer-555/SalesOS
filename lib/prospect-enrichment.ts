import { searchTavily } from "./tavily";
import { getCompanyDetails, getProfile, resolveUsername, slugifyCompany, type LinkedInProfile } from "./brightdata/linkedin";
import { BRIGHTDATA_API_KEY } from "./brightdata/serp";
import type { ProvenanceWebSource } from "./prospection/provenance";

// Le scrape de profil/entreprise Bright Data est asynchrone (10-60s).
// - Défaut COURT (~15s) : sûr pour les routes synchrones (prospection/generate,
//   regenerate single-email) qui doivent rester sous la limite Netlify ~26s.
//   Best-effort : si le scrape n'est pas prêt à temps, on dégrade sans LinkedIn.
// - Les contextes background (mass-prospection generate) passent un timeout long.
const DEFAULT_PROFILE_TIMEOUT_MS = 15_000;
const DEFAULT_COMPANY_TIMEOUT_MS = 15_000;

function usernameFromLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^\/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export interface LinkedInContextResult {
  text: string;
  currentCompanyUsername: string | null;
}

export async function fetchLinkedInContext(
  params: {
    firstName?: string;
    lastName?: string;
    email?: string;
    company?: string;
    linkedinUrl?: string | null;
  },
  opts: { profileTimeoutMs?: number } = {},
): Promise<LinkedInContextResult> {
  if (!BRIGHTDATA_API_KEY) return { text: "", currentCompanyUsername: null };
  try {
    const username = await resolveUsername({
      username: usernameFromLinkedInUrl(params.linkedinUrl) ?? undefined,
      firstName: params.firstName,
      lastName: params.lastName,
      company: params.company,
      email: params.email,
    });
    if (!username) return { text: "", currentCompanyUsername: null };
    const profile: LinkedInProfile = await getProfile(username, {
      timeoutMs: opts.profileTimeoutMs ?? DEFAULT_PROFILE_TIMEOUT_MS,
    });
    const positions = (profile.position ?? []).slice(0, 5).map((p) => {
      const start = p.start ? `${p.start.month ? p.start.month + "/" : ""}${p.start.year}` : "";
      const end = p.end?.year ? `${p.end.month ? p.end.month + "/" : ""}${p.end.year}` : "présent";
      return `- ${p.title} @ ${p.companyName} (${start} → ${end})${p.description ? `\n  ${p.description.slice(0, 200)}` : ""}`;
    }).join("\n");
    const skills = (profile.skills ?? []).slice(0, 12).map((s) => s.name).join(", ");
    const educations = (profile.educations ?? []).slice(0, 2).map((e) =>
      `${e.degree ?? ""} ${e.fieldOfStudy ?? ""} — ${e.schoolName ?? ""}`.trim()
    ).join(", ");
    const text = [
      `Headline LinkedIn : ${profile.headline ?? "—"}`,
      positions ? `Parcours :\n${positions}` : "",
      skills ? `Compétences : ${skills}` : "",
      educations ? `Formation : ${educations}` : "",
      profile.summary ? `Bio LinkedIn :\n${profile.summary.slice(0, 500)}` : "",
    ].filter(Boolean).join("\n");

    const currentCompanyUsername = profile.position?.[0]?.companyUsername?.trim() || null;
    return { text, currentCompanyUsername };
  } catch {
    return { text: "", currentCompanyUsername: null };
  }
}

/** Contexte web entreprise : `text` pour le prompt, `sources` pour la provenance. */
export interface CompanyWebContext {
  text: string;
  sources: ProvenanceWebSource[];
}

const EMPTY_WEB_CONTEXT: CompanyWebContext = { text: "", sources: [] };

export async function fetchCompanyWebContext(company: string): Promise<CompanyWebContext> {
  const name = company?.trim();
  if (!name) return EMPTY_WEB_CONTEXT;
  const results = await searchTavily(
    `${name} entreprise actualités initiative RH stratégie talents`,
    { days: 180, maxResults: 4 },
  );
  if (!results.length) return EMPTY_WEB_CONTEXT;
  const text = results
    .map((r) => {
      const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 320);
      const date = r.published_date ? ` (${r.published_date.slice(0, 10)})` : "";
      return `• ${r.title}${date}\n  ${snippet}`;
    })
    .join("\n");
  const sources: ProvenanceWebSource[] = results.map((r) => ({
    title: r.title,
    url: r.url,
    date: r.published_date ? r.published_date.slice(0, 10) : null,
  }));
  return { text, sources };
}

export function createCompanyContextCache() {
  const cache = new Map<string, Promise<CompanyWebContext>>();
  return (company: string): Promise<CompanyWebContext> => {
    const key = company?.trim().toLowerCase();
    if (!key) return Promise.resolve(EMPTY_WEB_CONTEXT);
    const existing = cache.get(key);
    if (existing) return existing;
    const p = fetchCompanyWebContext(company);
    cache.set(key, p);
    return p;
  };
}

/**
 * Enrichit avec les infos LinkedIn de l'entreprise (description, secteur, taille,
 * siège, effectifs). Préfère un slug LinkedIn fiable (extrait du profil du prospect)
 * et tombe sur un slug slugifié heuristique en dernier recours.
 */
export async function fetchCompanyLinkedInContext(
  company: string | null | undefined,
  hintedUsername: string | null = null,
  opts: { companyTimeoutMs?: number } = {},
): Promise<string> {
  if (!BRIGHTDATA_API_KEY) return "";
  const name = company?.trim();
  const slug = hintedUsername?.trim() || (name ? slugifyCompany(name) : "");
  if (!slug) return "";
  try {
    const d = await getCompanyDetails(slug, { timeoutMs: opts.companyTimeoutMs ?? DEFAULT_COMPANY_TIMEOUT_MS });
    return [
      d.name ? `Nom officiel : ${d.name}` : "",
      d.industry ? `Secteur : ${d.industry}` : "",
      d.companySize ? `Taille : ${d.companySize}` : "",
      d.employeeCount ? `Effectif : ${d.employeeCount}` : "",
      d.headquarters ? `Siège : ${d.headquarters}` : "",
      d.founded ? `Fondée : ${d.founded}` : "",
      d.website ? `Site : ${d.website}` : "",
      d.description ? `Description :\n${d.description.slice(0, 600)}` : "",
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

export function createCompanyLinkedInCache(companyTimeoutMs?: number) {
  const cache = new Map<string, Promise<string>>();
  return (company: string | null | undefined, hintedUsername: string | null = null): Promise<string> => {
    const name = company?.trim();
    const slug = hintedUsername?.trim() || (name ? slugifyCompany(name) : "");
    if (!slug) return Promise.resolve("");
    const existing = cache.get(slug);
    if (existing) return existing;
    const p = fetchCompanyLinkedInContext(name, hintedUsername, { companyTimeoutMs });
    cache.set(slug, p);
    return p;
  };
}
