/**
 * Client Bright Data partagé — zone SERP + appel /request.
 *
 * La zone SERP `salesos_serp` route vers Google et renvoie le JSON déjà parsé
 * par Bright Data quand l'URL contient `brd_json=1`. Le même endpoint
 * (`https://api.brightdata.com/request`) sert pour tous les verticaux Google
 * (Web, News, Maps, Shopping, Images, Trends) et pour la recherche de profils
 * LinkedIn via `site:linkedin.com/in`.
 */

export const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
export const SERP_ZONE = process.env.BRIGHTDATA_SERP_ZONE || "salesos_serp";
const REQUEST_ENDPOINT = "https://api.brightdata.com/request";

export function authHeaders() {
  return {
    Authorization: `Bearer ${BRIGHTDATA_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export interface SerpResult {
  /** Code HTTP renvoyé par Bright Data. */
  status: number;
  ok: boolean;
  /** Latence de l'appel en millisecondes. */
  ms: number;
  /** Body JSON envoyé à `/request` (pour l'inspecteur de requête). */
  sentBody: Record<string, unknown>;
  /** Réponse Bright Data : JSON Google parsé, ou texte brut si non-JSON. */
  data: unknown;
  /** True si `data` a pu être parsé en JSON. */
  isJson: boolean;
}

/**
 * Appelle la SERP API Bright Data avec une URL Google déjà construite.
 * Ne lève jamais sur un statut HTTP non-2xx : renvoie le détail dans `SerpResult`
 * pour que l'appelant décide quoi en faire (le front lit `data` même en erreur).
 */
export async function fetchSerp(googleUrl: string): Promise<SerpResult> {
  const sentBody = { zone: SERP_ZONE, url: googleUrl, format: "raw" };
  const start = performance.now();
  const res = await fetch(REQUEST_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(sentBody),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - start);

  let data: unknown = text;
  let isJson = false;
  try {
    data = JSON.parse(text);
    isJson = true;
  } catch {
    // garde le texte brut (HTML d'erreur, page non parsée, etc.)
  }

  return { status: res.status, ok: res.ok, ms, sentBody, data, isJson };
}

// ── Veille marché d'une entreprise via Google News (zone SERP) ──────────────
export interface MarketArticle {
  title: string;
  url: string;
  source: string;
  date: string; // libellé renvoyé par Google (ex. "13 oct. 2025", "Il y a 1 semaine")
  excerpt: string;
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
 * Convertit un libellé de date Google News en epoch ms (pour trier/filtrer).
 * Gère le relatif FR/EN ("Il y a 3 jours", "2 weeks ago", "hier", "yesterday"),
 * l'absolu parseable (ISO, "Oct 13, 2025") et l'absolu FR ("13 oct. 2025").
 * Renvoie null si non interprétable.
 */
export function parseGoogleDate(label: string | null | undefined): number | null {
  if (!label) return null;
  const raw = label.trim();
  const s = raw.toLowerCase();
  if (!s) return null;

  const now = Date.now();
  if (s === "hier" || s === "yesterday") return now - 86_400_000;
  if (s === "aujourd'hui" || s === "today" || s === "à l'instant" || s === "just now") return now;

  // Relatif : "il y a X unité" / "X unit(s) ago".
  if (s.includes("il y a") || s.includes("ago")) {
    const m = s.match(/(\d+)\s*([a-zàâéèêîïôûç]+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const ms = relUnitMs(unit);
      if (ms) return now - n * ms;
    }
  }

  // Absolu standard (ISO, "Oct 13, 2025", "2025-10-13").
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;

  // Absolu FR "13 oct. 2025".
  const fr = s.match(/(\d{1,2})\s+([a-zàâéèêîïôûç.]+)\.?\s+(\d{4})/);
  if (fr) {
    const idx = frMonthIndex(fr[2]);
    if (idx !== undefined) return new Date(parseInt(fr[3], 10), idx, parseInt(fr[1], 10)).getTime();
  }
  return null;
}

function frMonthIndex(token: string): number | undefined {
  const t = token.replace(/\./g, "");
  const table: [string, number][] = [
    ["janv", 0], ["fév", 1], ["fev", 1], ["mars", 2], ["avr", 3], ["mai", 4],
    ["juin", 5], ["juil", 6], ["août", 7], ["aout", 7], ["sept", 8],
    ["oct", 9], ["nov", 10], ["déc", 11], ["dec", 11],
  ];
  for (const [k, idx] of table) if (t.startsWith(k)) return idx;
  return undefined;
}

function relUnitMs(u: string): number | null {
  if (u.startsWith("min")) return 60_000;
  if (u.startsWith("heure") || u.startsWith("hour")) return 3_600_000;
  if (u.startsWith("jour") || u.startsWith("day")) return 86_400_000;
  if (u.startsWith("semaine") || u.startsWith("week")) return 604_800_000;
  if (u.startsWith("mois") || u.startsWith("month")) return 2_592_000_000; // ~30 j
  if (u.startsWith("an") || u.startsWith("année") || u.startsWith("year")) return 31_536_000_000;
  return null;
}

// Clé de dédup d'un article (hostname + titre normalisé).
function articleKey(a: MarketArticle): string {
  let host = a.url;
  try {
    host = new URL(a.url).hostname.replace(/^www\./, "");
  } catch {
    /* garde l'url brute */
  }
  return `${host}|${a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}

/**
 * Récupère les actualités marché d'une entreprise via la SERP API (Google News).
 * Lance 2 requêtes en parallèle (actu générale + signaux business) puis dédup.
 * Best-effort : ne lève jamais, renvoie [] si la zone/credits échouent.
 */
export async function fetchCompanyMarketNews(
  company: string,
  opts: { country?: string; lang?: string; since?: string; num?: number } = {},
): Promise<MarketArticle[]> {
  if (!BRIGHTDATA_API_KEY || !company.trim()) return [];

  const country = (opts.country || "fr").toLowerCase();
  const lang = (opts.lang || "fr").toLowerCase();
  const num = opts.num ?? 15;
  // Fenêtre de fraîcheur : 90 derniers jours par défaut (prospection = news
  // fraîches). Surchargeable via opts.since (ex. "2025-01-01").
  const since =
    opts.since ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d.toISOString().slice(0, 10);
    })();

  const name = `"${company.trim()}"`;
  // Vrais déclencheurs de prospection (signaux d'ACHAT), pas du brand/marketing.
  // On bannit "partenariat/expansion" et la requête "nom seul", qui ne ramènent
  // que du sponsoring, de la pub et des lancements de contenu grand public.
  const growth = `(levée OR "tour de table" OR financement OR valorisation OR acquisition OR rachat OR fusion OR "chiffre d'affaires" OR "résultats annuels" OR raises OR funding OR acquires)`;
  const org = `(recrute OR recrutement OR embauche OR nomination OR "nouveau directeur" OR "nouvelle directrice" OR licenciement OR "plan social" OR restructuration OR réorganisation OR régulation OR conformité OR sanction OR amende OR hiring OR layoffs OR appoints)`;
  const queries = [`${name} ${growth} after:${since}`, `${name} ${org} after:${since}`];

  const urls = queries.map(
    (q) =>
      `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&brd_json=1&num=${num}&hl=${lang}&gl=${country}`,
  );

  const results = await Promise.allSettled(urls.map((u) => fetchSerp(u)));

  const seen = new Set<string>();
  const articles: MarketArticle[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.isJson) continue;
    const data = r.value.data as { news?: GoogleNewsItem[] } | null;
    const news = Array.isArray(data?.news) ? data!.news : [];
    for (const n of news) {
      const url = n.link || n.url || "";
      const title = (n.title || "").trim();
      if (!url || !title) continue;
      const article: MarketArticle = {
        title,
        url,
        source: (n.source || "").trim(),
        date: (n.date || n.time || "").trim(),
        excerpt: (n.description || n.snippet || "").trim(),
      };
      const key = articleKey(article);
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(article);
    }
  }

  // Tri par date décroissante : les plus récentes d'abord (dates non
  // interprétables reléguées en fin de liste).
  articles.sort((a, b) => (parseGoogleDate(b.date) ?? 0) - (parseGoogleDate(a.date) ?? 0));

  return articles;
}
