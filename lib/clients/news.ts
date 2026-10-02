import { searchTavily } from "../tavily";
import { BRIGHTDATA_API_KEY, fetchCompanyMarketNews, parseGoogleDate } from "../brightdata/serp";
import type { News, NewsItem } from "./types";

// News entreprise pour la fiche client, deux sources dédupliquées :
//  - Tavily (web, 90 derniers jours) ;
//  - Google News via Bright Data SERP (mêmes requêtes "signaux" que la
//    Watchlist : résultats, M&A, nominations, restructurations, recrutement).
// Le tri "important pour le compte" est fait ensuite par rankClientNews, puis
// mergeNewsHistory fusionne avec les news déjà connues (12 mois glissants).
// Une source en échec est listée dans `errors` (jamais un 0 silencieux : les
// clés Bright Data ont déjà manqué en prod sans que personne ne le voie).

const TAVILY_MAX_RESULTS = 8;
const SEARCH_DAYS = 90;
const HISTORY_DAYS = 365;

function articleKey(title: string, url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* garde l'url brute */
  }
  return `${host}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}

// Deux médias reprennent souvent la même dépêche : on dédup aussi sur le titre seul.
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
}

export async function fetchClientNews(opts: {
  companyName: string;
  industry?: string | null;
}): Promise<News | null> {
  if (!opts.companyName.trim()) return null;
  const errors: string[] = [];

  // Tavily : entreprise + industrie (réduit les homonymes) + mots-clés signaux.
  const queryParts = [`"${opts.companyName}"`, "news"];
  if (opts.industry) queryParts.push(opts.industry);
  queryParts.push("funding OR hiring OR acquisition OR launch OR appoints OR restructuring");
  const tavilyPromise = process.env.TAVILY_API_KEY
    ? searchTavily(queryParts.join(" "), { days: SEARCH_DAYS, maxResults: TAVILY_MAX_RESULTS, depth: "basic" })
    : Promise.resolve(null);
  const serpErrors: string[] = [];
  const googlePromise = BRIGHTDATA_API_KEY
    ? fetchCompanyMarketNews(opts.companyName, { num: 10, errors: serpErrors })
    : Promise.resolve(null);

  const [tavily, google] = await Promise.all([
    tavilyPromise.catch((e) => {
      errors.push(`Web search failed (${e instanceof Error ? e.message : e})`);
      return [];
    }),
    googlePromise.catch((e) => {
      errors.push(`Google News failed (${e instanceof Error ? e.message : e})`);
      return [];
    }),
  ]);
  if (tavily === null) errors.push("Web search not configured (TAVILY_API_KEY)");
  if (google === null) errors.push("Google News not configured (BRIGHTDATA_API_KEY)");
  // Les 2 requêtes SERP ont échoué (credentials, zone, quota) : source KO.
  else if (serpErrors.length >= 2 && (google ?? []).length === 0) errors.push(`Google News failed (${serpErrors[0]})`);

  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const push = (it: NewsItem) => {
    const k1 = articleKey(it.title, it.url);
    const k2 = titleKey(it.title);
    if (seen.has(k1) || seen.has(k2)) return;
    seen.add(k1);
    seen.add(k2);
    items.push(it);
  };
  for (const a of google ?? []) {
    const ts = parseGoogleDate(a.date);
    push({
      title: a.title,
      url: a.url,
      published_at: ts ? new Date(ts).toISOString() : undefined,
      summary: a.excerpt?.slice(0, 280) || undefined,
      source_name: a.source || null,
      origin: "google_news",
    });
  }
  for (const r of tavily ?? []) {
    push({
      title: r.title,
      url: r.url,
      published_at: r.published_date,
      summary: r.content?.slice(0, 280),
      relevance: r.score,
      origin: "tavily",
    });
  }

  return { refreshed_at: new Date().toISOString(), items, errors: errors.length ? errors : undefined };
}

// Fusionne les news du passage courant (déjà rankées) avec l'historique : les
// news connues gardent leur first_seen_at (badge "New" seulement au 1er
// passage), les nouvelles prennent `now`. Purge au-delà de 12 mois et des
// items sans importance. Renvoie aussi le nombre de news importantes nouvelles.
export function mergeNewsHistory(
  previous: News | null,
  fresh: News,
): { news: News; newImportantCount: number } {
  const now = new Date().toISOString();
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const prevItems = previous?.items ?? [];
  const prevByKey = new Map(prevItems.map((it) => [titleKey(it.title), it]));

  let newImportantCount = 0;
  const merged = new Map<string, NewsItem>();
  for (const it of fresh.items) {
    const k = titleKey(it.title);
    const prev = prevByKey.get(k);
    const firstSeen = prev?.first_seen_at ?? (prev ? previous?.refreshed_at : undefined) ?? now;
    if (!prev && (it.importance === "high" || it.importance === "medium")) newImportantCount++;
    merged.set(k, { ...it, first_seen_at: firstSeen });
  }
  for (const it of prevItems) {
    const k = titleKey(it.title);
    if (merged.has(k)) continue;
    merged.set(k, { ...it, first_seen_at: it.first_seen_at ?? previous?.refreshed_at ?? now });
  }

  const items = [...merged.values()]
    .filter((it) => it.importance !== "low")
    .filter((it) => {
      const t = new Date(it.published_at ?? it.first_seen_at ?? now).getTime();
      return !Number.isFinite(t) || t >= cutoff;
    })
    .sort((a, b) => {
      const rank = (x: NewsItem) => (x.importance === "high" ? 2 : x.importance === "medium" ? 1 : 0);
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      const ta = new Date(a.published_at ?? a.first_seen_at ?? 0).getTime() || 0;
      const tb = new Date(b.published_at ?? b.first_seen_at ?? 0).getTime() || 0;
      return tb - ta;
    })
    .slice(0, 30);

  return {
    news: { refreshed_at: fresh.refreshed_at, items, errors: fresh.errors, ignored_count: fresh.ignored_count },
    newImportantCount,
  };
}
