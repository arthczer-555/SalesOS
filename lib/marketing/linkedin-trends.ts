/**
 * Tendances LinkedIn + web pour la fabrique de posts LinkedIn.
 *
 * On réutilise la zone SERP Bright Data (`fetchSerp`) exactement comme
 * `fetchCompanyMarketNews` : on construit des URL Google `brd_json=1`, on lance
 * les requêtes en parallèle, on parse `data.organic` / `data.news`, on dédup,
 * et on ne lève JAMAIS (best-effort → `[]` si la zone/credits échouent).
 *
 * - `fetchLinkedInTrends` : posts/articles LinkedIn qui rankent sur les thèmes
 *   coaching (`site:linkedin.com/posts OR site:linkedin.com/pulse`). Sert à la
 *   fois de signal de tendance ET d'inspiration ("ce qui marche").
 * - `fetchWebCoachingTrends` : actus/web coaching via Google News.
 */

import { BRIGHTDATA_API_KEY, fetchSerp } from "@/lib/brightdata/serp";

export interface LinkedInTrendItem {
  title: string;
  url: string;
  snippet: string;
  /** Hostname normalisé ou "linkedin.com". */
  source: string;
}

export interface WebTrendItem {
  title: string;
  url: string;
  source: string;
  date: string;
  excerpt: string;
}

type OrganicItem = {
  title?: string;
  link?: string;
  url?: string;
  description?: string;
  snippet?: string;
};

type NewsItem = OrganicItem & { source?: string; date?: string; time?: string };

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

// Clé de dédup : hostname + titre normalisé (court).
function dedupKey(url: string, title: string): string {
  return `${hostOf(url, url)}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}

/**
 * Récupère des posts/articles LinkedIn récents sur les mots-clés fournis.
 * Lance une requête SERP par mot-clé (restreinte à linkedin.com/posts|pulse),
 * dédup par URL+titre. Best-effort : renvoie [] si Bright Data est indisponible.
 */
export async function fetchLinkedInTrends(
  keywords: string[],
  opts: { country?: string; lang?: string; num?: number; perQuery?: number } = {},
): Promise<LinkedInTrendItem[]> {
  if (!BRIGHTDATA_API_KEY) return [];
  const terms = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 6);
  if (terms.length === 0) return [];

  const country = (opts.country || "us").toLowerCase();
  const lang = (opts.lang || "en").toLowerCase();
  const perQuery = opts.perQuery ?? 10;

  const urls = terms.map((kw) => {
    const q = `${kw} (site:linkedin.com/posts OR site:linkedin.com/pulse)`;
    return `https://www.google.com/search?q=${encodeURIComponent(q)}&brd_json=1&num=${perQuery}&hl=${lang}&gl=${country}`;
  });

  const results = await Promise.allSettled(urls.map((u) => fetchSerp(u)));

  const seen = new Set<string>();
  const items: LinkedInTrendItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.isJson || !r.value.ok) continue;
    const data = r.value.data as { organic?: OrganicItem[] } | null;
    const organic = Array.isArray(data?.organic) ? data!.organic : [];
    for (const o of organic) {
      const url = o.link || o.url || "";
      const title = (o.title || "").replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
      if (!url || !title) continue;
      if (!/linkedin\.com\/(posts|pulse|feed)/i.test(url)) continue;
      const key = dedupKey(url, title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title,
        url,
        snippet: (o.description || o.snippet || "").trim(),
        source: hostOf(url, "linkedin.com"),
      });
    }
  }

  const max = opts.num ?? 12;
  return items.slice(0, max);
}

/**
 * Récupère des actus/articles web sur les thèmes coaching (Google News).
 * Best-effort : renvoie [] si Bright Data est indisponible.
 */
export async function fetchWebCoachingTrends(
  keywords: string[],
  opts: { country?: string; lang?: string; num?: number; perQuery?: number } = {},
): Promise<WebTrendItem[]> {
  if (!BRIGHTDATA_API_KEY) return [];
  const terms = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4);
  if (terms.length === 0) return [];

  const country = (opts.country || "us").toLowerCase();
  const lang = (opts.lang || "en").toLowerCase();
  const perQuery = opts.perQuery ?? 10;

  const urls = terms.map(
    (kw) =>
      `https://www.google.com/search?q=${encodeURIComponent(kw)}&tbm=nws&brd_json=1&num=${perQuery}&hl=${lang}&gl=${country}`,
  );

  const results = await Promise.allSettled(urls.map((u) => fetchSerp(u)));

  const seen = new Set<string>();
  const items: WebTrendItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.isJson || !r.value.ok) continue;
    const data = r.value.data as { news?: NewsItem[] } | null;
    const news = Array.isArray(data?.news) ? data!.news : [];
    for (const n of news) {
      const url = n.link || n.url || "";
      const title = (n.title || "").trim();
      if (!url || !title) continue;
      const key = dedupKey(url, title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title,
        url,
        source: (n.source || hostOf(url, "")).trim(),
        date: (n.date || n.time || "").trim(),
        excerpt: (n.description || n.snippet || "").trim(),
      });
    }
  }

  const max = opts.num ?? 12;
  return items.slice(0, max);
}
