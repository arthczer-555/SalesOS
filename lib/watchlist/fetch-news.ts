import { getCompanyPosts } from "@/lib/brightdata/linkedin";
import { slugifyCompany } from "@/lib/slugify-company";
import { fetchCompanyMarketNews, parseGoogleDate } from "@/lib/brightdata/serp";
import { analyzeMarketNews } from "@/lib/watchlist/analyze-market-news";
import type { NewsContent } from "@/lib/watchlist/briefs";

// Fenêtre de fraîcheur des news (presse + posts LinkedIn) : 90 jours.
const FRESHNESS_DAYS = 90;

interface FetchNewsInput {
  scopeCompanyId: string;
  userId: string;
  companyName: string;
}

// Posts LinkedIn via Bright Data (dataset posts, discover by company URL).
// Best-effort : renvoie [] si l'entreprise est introuvable ou si le scrape
// n'aboutit pas à temps (ne lève pas).
async function fetchLinkedInPosts(slug: string): Promise<{ posts: NewsContent["posts"]; creditsUsed: number }> {
  if (!slug) return { posts: [], creditsUsed: 0 };
  const res = await getCompanyPosts(slug, { timeoutMs: 25_000 });
  const posts = res.data ?? [];
  return { posts, creditsUsed: posts.length > 0 ? 1 : 0 };
}

/**
 * Fetch des news pour un compte Watch List :
 * - posts LinkedIn récents via Bright Data getCompanyPosts (dataset, discover by URL)
 * - veille marché (presse) via la SERP API Bright Data (Google News), catégorisée
 *   et synthétisée par Claude → `signals` + `intel_summary`.
 *
 * Les deux sources tournent en parallèle. La veille Bright Data est best-effort :
 * un échec (zone/credits/API) ne fait pas planter la brief, on garde les posts.
 */
export async function fetchWatchlistNews(input: FetchNewsInput): Promise<NewsContent> {
  const { companyName, userId } = input;
  const slug = slugifyCompany(companyName);

  // Veille marché (SERP) et posts LinkedIn (dataset) en parallèle, tous deux
  // best-effort via Bright Data (ne lèvent pas).
  const marketPromise = fetchCompanyMarketNews(companyName).catch(() => []);
  const { posts, creditsUsed } = await fetchLinkedInPosts(slug);

  const articles = await marketPromise;
  const intel = await analyzeMarketNews(articles, { companyName, userId });

  const cutoff = Date.now() - FRESHNESS_DAYS * 86_400_000;

  // Posts LinkedIn : on écarte les posts plus vieux que la fenêtre (date non
  // parseable = on garde, par prudence) et on trie du plus récent au plus ancien.
  const freshPosts = posts
    .filter((p) => {
      const t = Date.parse(p.postedAt);
      return Number.isNaN(t) || t >= cutoff;
    })
    .sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

  // Signaux presse : on écarte les news plus vieilles que la fenêtre 90j (date
  // non parseable = on garde, par prudence, comme pour les posts) puis tri par
  // date décroissante. Le filtre `after:` Google + le fallback sans Claude
  // peuvent laisser passer des articles hors fenêtre : on coupe ici aussi.
  const freshSignals = intel.signals
    .filter((s) => {
      const t = parseGoogleDate(s.created_at);
      return t === null || t >= cutoff;
    })
    .sort((a, b) => (parseGoogleDate(b.created_at) ?? 0) - (parseGoogleDate(a.created_at) ?? 0));

  return {
    posts: freshPosts,
    signals: freshSignals,
    intel_summary: intel.summary,
    fetched_at: new Date().toISOString(),
    credits_used: creditsUsed,
  };
}
