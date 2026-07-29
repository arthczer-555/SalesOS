/**
 * Récolte des items bruts du scan marché global (Google News + posts LinkedIn),
 * via la SERP Bright Data uniquement.
 *
 * Il n'y a plus de balayage compte par compte : on ne surveille plus des
 * sociétés, on surveille des évènements. Le rattachement à un compte connu se
 * fait après coup (`linkExistingCompanies`), ce qui donne la même information
 * pour 46 requêtes/jour au lieu de 302.
 */

import { fetchSerp, parseGoogleDate, BRIGHTDATA_API_KEY } from "@/lib/brightdata/serp";
import { enabledPostQueries, enabledScanQueries } from "./queries";
import { mapLimit } from "./util";
import type { RawItem, SignalType } from "./types";

// Fenêtre de fraîcheur des sources (jours). On récolte large puis Claude trie.
const SINCE_DAYS = 21;

/** Nb de posts gardés par requête mot-clé. */
const MAX_POSTS_PER_QUERY = 15;

/** Requêtes SERP simultanées : borne la charge et la latence de la récolte. */
const FETCH_CONCURRENCY = 6;

/** Type pressenti par famille de requête (le scorer peut le corriger). */
const FAMILY_KIND: Record<string, SignalType> = {
  funding: "funding",
  people_move: "nomination",
  restructuring: "restructuring",
  scaling: "hiring",
  leadership_program: "content",
};

function sinceDate(days = SINCE_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface GoogleNewsItem {
  title?: string;
  link?: string;
  url?: string;
  source?: string;
  date?: string;
  time?: string;
  description?: string;
  snippet?: string;
}

/**
 * Lance une requête Google News et renvoie des RawItem.
 * Best-effort : [] si pas de clé / échec (le sweep continue sur les autres).
 */
async function fetchNews(
  query: string,
  opts: { kindHint: SignalType; queryId: string; country: string; lang: string; num: number },
): Promise<RawItem[]> {
  if (!BRIGHTDATA_API_KEY || !query.trim()) return [];
  const q = `${query} after:${sinceDate()}`;
  const url =
    `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&brd_json=1` +
    `&num=${opts.num}&hl=${opts.lang.toLowerCase()}&gl=${opts.country.toLowerCase()}`;

  const r = await fetchSerp(url).catch(() => null);
  if (!r || !r.isJson || !r.ok) return [];
  const data = r.data as { news?: GoogleNewsItem[] } | null;
  const news = Array.isArray(data?.news) ? data!.news : [];
  const items: RawItem[] = [];
  for (const n of news) {
    const link = n.link || n.url || "";
    const title = (n.title || "").trim();
    if (!link || !title) continue;
    items.push({
      feed: "discovery",
      source: "brightdata_serp",
      kindHint: opts.kindHint,
      title,
      url: link,
      snippet: (n.description || n.snippet || "").trim(),
      date: (n.date || n.time || "").trim() || null,
      queryId: opts.queryId,
    });
  }
  return items;
}

/**
 * Récolte toute la grille de news globale. `onlyQueries` limite aux ids donnés :
 * c'est le mode de développement, pour itérer sur le scoring sans relancer 36
 * requêtes à chaque essai.
 */
export async function collectGlobalNews(onlyQueries?: string[] | null): Promise<RawItem[]> {
  const queries = enabledScanQueries(onlyQueries);
  const batches = await mapLimit(queries, FETCH_CONCURRENCY, (q) =>
    fetchNews(q.q, {
      kindHint: FAMILY_KIND[q.family] ?? "nomination",
      queryId: q.id,
      country: q.gl,
      lang: q.hl,
      num: q.num,
    }).catch(() => [] as RawItem[]),
  );
  return dedupeByUrl(batches.flat());
}

// ── Posts LinkedIn (SERP organique, aucun record de dataset) ─────────────────

interface SerpOrganic {
  link?: string;
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
}

/** Lance une requête Google "organique" (web) via la SERP API. Best-effort. */
async function fetchSerpOrganic(query: string, lang: string, num: number): Promise<SerpOrganic[]> {
  if (!BRIGHTDATA_API_KEY || !query.trim()) return [];
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1&num=${num}&hl=${lang.toLowerCase()}`;
  const r = await fetchSerp(url).catch(() => null);
  if (!r || !r.isJson || !r.ok) return [];
  const data = r.data as { organic?: SerpOrganic[] } | null;
  return Array.isArray(data?.organic) ? data!.organic : [];
}

/**
 * Un nom de personne plausible ? Deux ou trois tokens d'au moins deux lettres.
 *
 * Garde-fou du fallback "humanisation du slug" ci-dessous : sans lui, des slugs
 * exotiques produisent des noms bruités qui partiraient ensuite dans un email
 * deviné. Mieux vaut perdre un post que fabriquer un destinataire.
 */
function looksLikePersonName(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every((t) => t.replace(/[^\p{L}]/gu, "").length >= 2);
}

/**
 * Extrait l'auteur (nom + URL profil) d'un post LinkedIn depuis son URL et son
 * titre SERP. L'URL `/posts/<slug>_...` porte le slug profil ; le titre porte
 * souvent le nom ("Post de X", "X's Post"). Renvoie null si ça ressemble à une
 * page entreprise plutôt qu'à une personne.
 */
function parsePostAuthor(postUrl: string, title: string): { name: string; linkedin: string } | null {
  const m = postUrl.match(/linkedin\.com\/posts\/([^_/?#]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  if (!slug) return null;
  const linkedin = `https://www.linkedin.com/in/${slug}/`;

  const clean = title.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  // "Post de Nicolas DUGAY" / "Publication de X"
  let name = clean.match(/^(?:post|publication)\s+de\s+(.+)$/i)?.[1]?.trim() ?? "";
  // "Chris Jensen's Post" / "Erik Cardenas' Post"
  if (!name) name = clean.match(/^(.+?)['']s?\s+post$/i)?.[1]?.trim() ?? "";
  // "Name - headline" : on garde la partie avant le tiret si ça ressemble à un nom.
  if (!name) {
    const head = clean.split(" - ")[0]?.trim() ?? "";
    if (/^[A-ZÀ-Ÿ][\p{L}.'-]+(?:\s+[A-ZÀ-Ÿ][\p{L}.'-]+){1,2}$/u.test(head)) name = head;
  }
  // Fallback : on humanise le slug s'il contient des tirets (prenom-nom-xxxx).
  if (!name && slug.includes("-")) {
    name = slug
      .replace(/-[0-9a-f]{6,}$/i, "") // enlève le suffixe d'unicité LinkedIn
      .split("-")
      .filter((t) => !/^\d+$/.test(t))
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .join(" ")
      .trim();
  }
  if (!name || !looksLikePersonName(name)) return null;
  return { name, linkedin };
}

/**
 * Découvre des posts LinkedIn "intéressants" par mots-clés (thèmes coaching /
 * leadership / L&D / scaling...) via la SERP Google `site:linkedin.com/posts`.
 *
 * Canal le moins cher au lead de tout le pipeline : l'auteur du post EST le lead,
 * nom et URL de profil compris, sans un seul appel payant supplémentaire.
 */
export async function collectLinkedInPostDiscovery(onlyQueries?: string[] | null): Promise<RawItem[]> {
  const queries = enabledPostQueries(onlyQueries);
  const batches = await mapLimit(queries, FETCH_CONCURRENCY, async (t) => {
    const organic = await fetchSerpOrganic(`${t.q} site:linkedin.com/posts`, t.hl, 15).catch(() => []);
    const items: RawItem[] = [];
    for (const o of organic) {
      if (items.length >= MAX_POSTS_PER_QUERY) break;
      const url = o.link || o.url || "";
      if (!/linkedin\.com\/posts\//i.test(url)) continue;
      const title = (o.title || "").trim();
      const snippet = (o.description || o.snippet || "").trim();
      if (!snippet) continue;
      const author = parsePostAuthor(url, title);
      if (!author) continue; // pas de personne identifiable (page entreprise, etc.)
      items.push({
        feed: "discovery",
        source: "brightdata_linkedin",
        kindHint: "linkedin_post",
        title: `${author.name} on LinkedIn: ${snippet.slice(0, 80)}${snippet.length > 80 ? "…" : ""}`,
        url,
        snippet: snippet.slice(0, 400),
        date: null,
        // Fallback d'affichage tant que la société réelle n'est pas résolue.
        knownCompanyName: author.name,
        author,
        queryId: t.id,
      });
    }
    return items;
  });
  return dedupeByUrl(batches.flat());
}

// ── Utilitaire ───────────────────────────────────────────────────────────────

function dedupeByUrl(items: RawItem[]): RawItem[] {
  const seen = new Set<string>();
  const out: RawItem[] = [];
  for (const it of items) {
    const key = it.url ?? `${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Convertit un libellé de date brut en ISO (ou null). */
export function rawDateToIso(label: string | null): string | null {
  const ms = parseGoogleDate(label);
  if (ms) return new Date(ms).toISOString();
  if (label) {
    const direct = Date.parse(label);
    if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  }
  return null;
}
