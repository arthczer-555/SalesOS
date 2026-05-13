import { searchTavily } from "./tavily";
import { getCompanyDetails, getProfile, resolveUsername, slugifyCompany, type LinkedInProfile } from "./netrows";

function usernameFromLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^\/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export interface LinkedInContextResult {
  text: string;
  currentCompanyUsername: string | null;
}

export async function fetchLinkedInContext(params: {
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  linkedinUrl?: string | null;
}): Promise<LinkedInContextResult> {
  if (!process.env.NETROWS_API_KEY) return { text: "", currentCompanyUsername: null };
  try {
    const username = await resolveUsername({
      username: usernameFromLinkedInUrl(params.linkedinUrl) ?? undefined,
      firstName: params.firstName,
      lastName: params.lastName,
      company: params.company,
      email: params.email,
    });
    if (!username) return { text: "", currentCompanyUsername: null };
    const profile: LinkedInProfile = await getProfile(username);
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

export async function fetchCompanyWebContext(company: string): Promise<string> {
  const name = company?.trim();
  if (!name) return "";
  const results = await searchTavily(
    `${name} entreprise actualités initiative RH stratégie talents`,
    { days: 180, maxResults: 4 },
  );
  if (!results.length) return "";
  return results
    .map((r) => {
      const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 320);
      const date = r.published_date ? ` (${r.published_date.slice(0, 10)})` : "";
      return `• ${r.title}${date}\n  ${snippet}`;
    })
    .join("\n");
}

export function createCompanyContextCache() {
  const cache = new Map<string, Promise<string>>();
  return (company: string): Promise<string> => {
    const key = company?.trim().toLowerCase();
    if (!key) return Promise.resolve("");
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
): Promise<string> {
  if (!process.env.NETROWS_API_KEY) return "";
  const name = company?.trim();
  const slug = hintedUsername?.trim() || (name ? slugifyCompany(name) : "");
  if (!slug) return "";
  try {
    const d = await getCompanyDetails(slug);
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

export function createCompanyLinkedInCache() {
  const cache = new Map<string, Promise<string>>();
  return (company: string | null | undefined, hintedUsername: string | null = null): Promise<string> => {
    const name = company?.trim();
    const slug = hintedUsername?.trim() || (name ? slugifyCompany(name) : "");
    if (!slug) return Promise.resolve("");
    const existing = cache.get(slug);
    if (existing) return existing;
    const p = fetchCompanyLinkedInContext(name, hintedUsername);
    cache.set(slug, p);
    return p;
  };
}
