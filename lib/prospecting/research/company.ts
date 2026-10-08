// Recherche entreprise partagée entre prospects (cache DB 14 jours dans
// prospecting_company_research) : fiche LinkedIn, actualités orientées persona
// (Tavily), offres d'emploi (Bright Data, signal fort pour les sales leaders) et
// briefs Watch List si le prospect est rattaché à un compte suivi.
// Chaque source en échec est listée dans `errors`, jamais masquée par un vide.
import { db } from "@/lib/db";
import { getCompanyJobs } from "@/lib/brightdata/linkedin";
import { BRIGHTDATA_API_KEY } from "@/lib/brightdata/serp";
import { fetchCompanyLinkedInContext } from "@/lib/prospect-enrichment";
import { slugifyCompany } from "@/lib/slugify-company";
import { searchTavily } from "@/lib/tavily";
import { getBriefs } from "@/lib/watchlist/briefs";
import { errMessage, normDomain, nowIso } from "../store/util";
import type { CompanyResearch, Persona } from "../types";
import type { CompanyResearchCache, CompanyResearchResult, NewsFlavor } from "../ai/types";

const TTL_MS = 14 * 86_400_000;
/** Mémo process : évite de re-scraper une entreprise dont le scrape vient d'échouer (même batch). */
const MEMO_MS = 10 * 60_000;
const NEWS_DAYS = 120;
const RETRY_AFTER_FAILURE_MS = 86_400_000;

const inflight = new Map<string, Promise<CompanyResearchResult>>();
const memo = new Map<string, { at: number; value: CompanyResearchResult }>();

export function companyKey(name: string | null | undefined, domain: string | null | undefined): string | null {
  const d = normDomain(domain);
  if (d) return d;
  const slug = name ? slugifyCompany(name) : "";
  return slug ? `name:${slug}` : null;
}

export function newsFlavor(persona: Persona | null): NewsFlavor {
  if (!persona) return "hr";
  if (persona.id === "sales_leaders" || persona.targeting.departments.includes("sales")) return "sales";
  return "hr";
}

// ── Offres d'emploi ─────────────────────────────────────────────────────────

const SALES_TITLE_CI = /account executive|sales|business develop|inside sales|account manager|key account|commercial|ventes|vendeur|revenue/i;
const SALES_TITLE_CS = /\b(AE|SDR|BDR|KAM)\b/;

export function isSalesTitle(title: string, extra: string[] = []): boolean {
  if (SALES_TITLE_CI.test(title) || SALES_TITLE_CS.test(title)) return true;
  const t = title.toLowerCase();
  return extra.some((x) => x.trim() && t.includes(x.trim().toLowerCase()));
}

async function fetchJobs(name: string, timeoutMs: number, hiringTitles: string[]): Promise<CompanyResearch["jobs"]> {
  const res = await getCompanyJobs(name, { timeoutMs });
  const rows = (res.data ?? []).filter((j) => j.title.trim());
  // collectAndWait renvoie [] en cas d'échec comme en cas d'absence : on ne
  // peut pas conclure "0 poste ouvert", donc null (affiché comme indisponible).
  if (!rows.length) return null;
  const sales = rows.filter((j) => isSalesTitle(j.title, hiringTitles));
  return {
    salesOpenings: sales.length,
    total: rows.length,
    sample: [...sales, ...rows.filter((j) => !sales.includes(j))].slice(0, 6).map((j) => ({ title: j.title, location: j.location, url: j.url })),
  };
}

// ── Actualités ──────────────────────────────────────────────────────────────

function newsQuery(name: string, flavor: NewsFlavor): string {
  return flavor === "sales"
    ? `"${name}" sales team OR hiring sales OR expansion OR funding OR "product launch" OR "new market" OR "Chief Revenue Officer"`
    : `"${name}" HR OR talent OR leadership OR managers OR "people team" OR learning OR training OR culture OR restructuring`;
}

async function fetchNews(name: string, flavor: NewsFlavor): Promise<CompanyResearch["news"]> {
  const results = await searchTavily(newsQuery(name, flavor), { days: NEWS_DAYS, maxResults: 5, depth: "basic" });
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    date: r.published_date ? r.published_date.slice(0, 10) : null,
    snippet: (r.content || "").replace(/\s+/g, " ").trim().slice(0, 300),
  }));
}

// ── Watch List ──────────────────────────────────────────────────────────────

async function watchlistContext(scopeCompanyId: string): Promise<string | null> {
  const briefs = await getBriefs(scopeCompanyId);
  const lines: string[] = [];
  const ae = briefs.ae_analysis?.content;
  if (ae) {
    if (ae.relationship_state) lines.push(`Relation (Watch List) : ${ae.relationship_state}`);
    if (ae.state_summary) lines.push(`Situation du compte : ${ae.state_summary}`);
    if (ae.watch_outs?.length) lines.push(`Points de vigilance : ${ae.watch_outs.slice(0, 3).join(" ; ")}`);
  }
  const news = briefs.news?.content;
  if (news?.signals?.length) {
    lines.push("Signaux récents (Watch List) :");
    for (const s of news.signals.slice(0, 4)) {
      lines.push(`- [${(s.created_at ?? "").slice(0, 10)}] ${s.title}${s.url ? ` (${s.url})` : ""}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

// ── API ─────────────────────────────────────────────────────────────────────

export interface CompanyResearchInput {
  name: string | null;
  domain: string | null;
  persona: Persona | null;
  scopeCompanyId?: string | null;
  /** Slug LinkedIn fiable (extrait du profil du prospect). */
  linkedinHint?: string | null;
  /** Mode background : timeouts de scrape longs. */
  background?: boolean;
  force?: boolean;
}

function emptyCache(): CompanyResearchCache {
  return { linkedin: "", linkedinFetchedAt: null, jobs: null, jobsFetchedAt: null, newsByFlavor: {}, watchlist: null, errors: [] };
}

function isFresh(at: string | null | undefined): boolean {
  return !!at && Date.now() - new Date(at).getTime() < TTL_MS;
}

async function compute(key: string, input: CompanyResearchInput): Promise<CompanyResearchResult> {
  const name = (input.name ?? "").trim();
  const flavor = newsFlavor(input.persona);
  const timeoutMs = input.background ? 40_000 : 10_000;

  const { data: row } = await db.from("prospecting_company_research").select("data, fetched_at").eq("key", key).maybeSingle();
  const cached: CompanyResearchCache = { ...emptyCache(), ...((row?.data as Partial<CompanyResearchCache> | undefined) ?? {}) };
  const force = !!input.force;

  const recentlyFailed = (src: "linkedin" | "jobs") => {
    const at = cached.failedAt?.[src];
    return !!at && Date.now() - new Date(at).getTime() < RETRY_AFTER_FAILURE_MS;
  };
  const needLinkedin = force || (!isFresh(cached.linkedinFetchedAt) && !recentlyFailed("linkedin"));
  const needJobs = force || (!isFresh(cached.jobsFetchedAt) && !recentlyFailed("jobs"));
  const needNews = force || !isFresh(cached.newsByFlavor[flavor]?.fetchedAt);
  const errors: string[] = [];

  const [linkedin, jobs, news, watchlist] = await Promise.all([
    needLinkedin && name
      ? BRIGHTDATA_API_KEY
        ? fetchCompanyLinkedInContext(name, input.linkedinHint ?? null, { companyTimeoutMs: timeoutMs }).catch((e) => {
            errors.push(`Company LinkedIn failed (${errMessage(e)})`);
            return "";
          })
        : Promise.resolve(null)
      : Promise.resolve(undefined),
    needJobs && name
      ? BRIGHTDATA_API_KEY
        ? fetchJobs(name, timeoutMs, input.persona?.targeting.hiringTitles ?? []).catch((e) => {
            errors.push(`Job posts failed (${errMessage(e)})`);
            return null;
          })
        : Promise.resolve(null)
      : Promise.resolve(undefined),
    needNews && name
      ? process.env.TAVILY_API_KEY
        ? fetchNews(name, flavor).catch((e) => {
            errors.push(`News search failed (${errMessage(e)})`);
            return null;
          })
        : Promise.resolve(null)
      : Promise.resolve(undefined),
    input.scopeCompanyId
      ? watchlistContext(input.scopeCompanyId).catch((e) => {
          errors.push(`Watch List briefs failed (${errMessage(e)})`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const now = nowIso();
  const next: CompanyResearchCache = {
    ...cached,
    newsByFlavor: { ...cached.newsByFlavor },
    failedAt: { ...(cached.failedAt ?? {}) },
    watchlist: watchlist ?? cached.watchlist,
  };
  const failed = (src: "linkedin" | "jobs") => {
    next.failedAt = { ...next.failedAt, [src]: now };
  };
  if (!name) errors.push("No company name on this prospect");
  // Échec récent (moins de 24 h) : pas de nouveau scrape, mais l'erreur reste affichée.
  if (!needLinkedin && !cached.linkedin && recentlyFailed("linkedin")) errors.push("Company LinkedIn page unavailable (last attempt failed, retried tomorrow)");
  if (!needJobs && !cached.jobs && recentlyFailed("jobs")) errors.push("Job posts unavailable (last attempt failed, retried tomorrow)");
  if (linkedin !== undefined) {
    if (linkedin === null) errors.push("Company LinkedIn not configured (BRIGHTDATA_API_KEY)");
    else if (linkedin) {
      next.linkedin = linkedin;
      next.linkedinFetchedAt = now;
      if (next.failedAt) delete next.failedAt.linkedin;
    } else {
      failed("linkedin");
      if (!errors.some((e) => e.startsWith("Company LinkedIn"))) errors.push("Company LinkedIn page unavailable (not found or scrape too slow)");
    }
  }
  if (jobs !== undefined) {
    if (!BRIGHTDATA_API_KEY) errors.push("Job posts not configured (BRIGHTDATA_API_KEY)");
    else if (jobs) {
      next.jobs = jobs;
      next.jobsFetchedAt = now;
      if (next.failedAt) delete next.failedAt.jobs;
    } else {
      failed("jobs");
      if (!errors.some((e) => e.startsWith("Job posts"))) errors.push("Job posts unavailable (scrape too slow or none listed)");
    }
  }
  if (news !== undefined) {
    if (!process.env.TAVILY_API_KEY) errors.push("News search not configured (TAVILY_API_KEY)");
    else if (news) next.newsByFlavor[flavor] = { items: news, fetchedAt: now };
  }
  // Les erreurs de la dernière tentative remplacent les anciennes : un scrape
  // réussi efface son erreur, un échec reste visible jusqu'au prochain essai.
  next.errors = errors;

  const changed = linkedin !== undefined || jobs !== undefined || news !== undefined;
  if (changed && name) {
    const { error } = await db.from("prospecting_company_research").upsert(
      { key, company_name: name || null, domain: normDomain(input.domain), data: next, fetched_at: now },
      { onConflict: "key" },
    );
    if (error) console.error("[prospecting] company research cache write failed:", error.message);
  }

  return {
    key,
    linkedin: next.linkedin,
    news: next.newsByFlavor[flavor]?.items ?? [],
    jobs: next.jobs,
    watchlist: next.watchlist,
    errors,
    fetchedAt: row?.fetched_at && !changed ? String(row.fetched_at) : now,
    fromCache: !changed,
  };
}

/**
 * Recherche entreprise (cache DB 14 j, dédoublonnage des appels concurrents et
 * mémo court en process pour partager le résultat entre les prospects d'un
 * même batch).
 */
export async function getCompanyResearch(input: CompanyResearchInput): Promise<CompanyResearchResult> {
  const key = companyKey(input.name, input.domain);
  if (!key) {
    return { key: "", linkedin: "", news: [], jobs: null, watchlist: null, errors: ["No company name or domain on this prospect"], fetchedAt: nowIso(), fromCache: false };
  }
  const memoKey = `${key}|${newsFlavor(input.persona)}|${input.scopeCompanyId ?? ""}`;
  if (!input.force) {
    const m = memo.get(memoKey);
    if (m && Date.now() - m.at < MEMO_MS) return m.value;
    const running = inflight.get(memoKey);
    if (running) return running;
  }
  const p = compute(key, input)
    .then((value) => {
      memo.set(memoKey, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(memoKey));
  inflight.set(memoKey, p);
  return p;
}

/** Texte "faits entreprise" pour le prompt (LinkedIn + Watch List). */
export function companyFacts(r: CompanyResearchResult): string {
  return [r.linkedin ? `Fiche LinkedIn :\n${r.linkedin}` : "", r.watchlist ? `Watch List :\n${r.watchlist}` : ""].filter(Boolean).join("\n\n");
}

export function newsFacts(r: CompanyResearchResult): string {
  return r.news.map((n) => `- [${n.date ?? "date inconnue"}] ${n.title} (${n.url})${n.snippet ? `\n  ${n.snippet}` : ""}`).join("\n");
}

export function hiringFacts(r: CompanyResearchResult): string {
  if (!r.jobs) return "";
  const head = `${r.jobs.salesOpenings} poste(s) sales parmi les ${r.jobs.total} dernières offres d'emploi publiées sur LinkedIn.`;
  return [head, ...r.jobs.sample.map((j) => `- ${j.title}${j.location ? ` (${j.location})` : ""}${j.url ? ` ${j.url}` : ""}`)].join("\n");
}
