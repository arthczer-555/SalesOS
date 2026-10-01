/**
 * Outils LinkedIn (Bright Data) de CoachelloAI (extraits de l'ancien core.ts).
 * Scrapes best-effort : quelques secondes, coûteux, uniquement quand la question
 * le justifie (cf. descriptions).
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  getProfile,
  searchPeople,
  resolveUsername,
  getPeopleActivity,
  getCompanyDetails,
  getCompanyPosts,
  getCompanyJobs,
  searchCompanies,
} from "@/lib/brightdata/linkedin";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "search_linkedin_people",
    description: "Recherche des profils LinkedIn par entreprise et/ou titre de poste (sourcing de prospects, décideurs). Rapide. Pas de recherche d'email ici : pour un email, utilise HubSpot.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string" },
        keywordTitle: { type: "string" },
        keywords: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        start: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_profile",
    description: "Profil LinkedIn complet d'une personne via son username (fallback automatique nom + entreprise). Scrape lent (quelques secondes), best-effort : si ça échoue, dis-le, n'invente pas.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        company: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_activity",
    description: "Derniers posts publiés par un profil LinkedIn (best-effort, scrape lent). Utile pour personnaliser une approche.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_posts",
    description: "Liste les derniers posts publiés par un profil LinkedIn (best-effort).",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company",
    description: "Détails d'une entreprise LinkedIn (effectifs, secteur, siège, followers). Best-effort, scrape lent.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_posts",
    description: "Derniers posts publiés par une page entreprise LinkedIn (best-effort).",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" }, start: { type: "number" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_jobs",
    description: "Offres d'emploi publiées par une entreprise sur LinkedIn (signal de croissance/recrutement, best-effort).",
    input_schema: {
      type: "object" as const,
      properties: { company: { type: "string" } },
      required: ["company"],
    },
  },
  {
    name: "search_linkedin_companies",
    description: "Recherche d'entreprises sur LinkedIn par mots-clés / industrie / taille.",
    input_schema: {
      type: "object" as const,
      properties: { keyword: { type: "string" }, industry: { type: "string" }, size: { type: "string" } },
      required: ["keyword"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    search_linkedin_people: async (input) => {
      try {
        const r = await searchPeople({
          company: input.company as string | undefined,
          keywordTitle: input.keywordTitle as string | undefined,
          keywords: input.keywords as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          start: input.start as number | undefined,
        });
        const items = r.data?.items ?? [];
        if (items.length === 0) return "Aucun profil trouvé.";
        return JSON.stringify(items.slice(0, 20));
      } catch (e) {
        return `Erreur LinkedIn search : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    get_linkedin_profile: async (input) => {
      try {
        const username = await resolveUsername({
          username: input.username as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          company: input.company as string | undefined,
        });
        if (!username) return "Aucun username LinkedIn trouvé. Précise le nom complet et l'entreprise.";
        const profile = await getProfile(username);
        return JSON.stringify({
          username: profile.username,
          name: `${profile.firstName} ${profile.lastName}`,
          headline: profile.headline,
          summary: (profile.summary ?? "").slice(0, 600),
          location: profile.geo?.city ? `${profile.geo.city}, ${profile.geo.country}` : profile.geo?.country,
          positions: (profile.position ?? []).slice(0, 5).map((p) => ({
            company: p.companyName, title: p.title,
            start: p.start ? `${p.start.year}-${String(p.start.month ?? 1).padStart(2, "0")}` : null,
            end: p.end?.year ? `${p.end.year}-${String(p.end.month ?? 1).padStart(2, "0")}` : "actuel",
          })),
          skills: (profile.skills ?? []).slice(0, 15).map((s) => s.name),
          education: (profile.educations ?? []).slice(0, 3).map((e) => `${e.schoolName} - ${e.degree ?? ""} ${e.fieldOfStudy ?? ""}`.trim()),
        });
      } catch (e) {
        return `Erreur LinkedIn profile : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    get_linkedin_activity: async (input) => {
      try { const r = await getPeopleActivity(input.username as string, { timeoutMs: 18_000 }); return JSON.stringify((r.data ?? []).slice(0, 15)); }
      catch (e) { return `Erreur LinkedIn posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    },

    get_linkedin_posts: async (input) => {
      try { const r = await getPeopleActivity(input.username as string, { timeoutMs: 18_000 }); return JSON.stringify((r.data ?? []).slice(0, 15)); }
      catch (e) { return `Erreur LinkedIn posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    },

    get_linkedin_company: async (input) => {
      try { const c = await getCompanyDetails(input.username as string, { timeoutMs: 18_000 }); return c.name ? JSON.stringify(c) : "Fiche entreprise non disponible (scrape trop lent ou introuvable)."; }
      catch (e) { return `Erreur LinkedIn company : ${e instanceof Error ? e.message : "inconnue"}`; }
    },

    get_linkedin_company_posts: async (input) => {
      try { const r = await getCompanyPosts(input.username as string, { timeoutMs: 18_000 }); return JSON.stringify((r.data ?? []).slice(0, 10)); }
      catch (e) { return `Erreur LinkedIn company posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    },

    get_linkedin_company_jobs: async (input) => {
      try { const r = await getCompanyJobs(input.company as string, { timeoutMs: 18_000 }); return JSON.stringify((r.data ?? []).slice(0, 20)); }
      catch (e) { return `Erreur LinkedIn jobs : ${e instanceof Error ? e.message : "inconnue"}`; }
    },

    search_linkedin_companies: async (input) => {
      try {
        const r = await searchCompanies({
          keyword: input.keyword as string,
          industry: input.industry as string | undefined,
          size: input.size as string | undefined,
        });
        return JSON.stringify((r.data?.items ?? []).slice(0, 20));
      } catch (e) { return `Erreur LinkedIn search companies : ${e instanceof Error ? e.message : "inconnue"}`; }
    },
  },
};

export const linkedinTools = module_;
