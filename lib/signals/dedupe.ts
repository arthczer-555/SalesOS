import { createHash } from "crypto";
import type { ScoredSignal } from "./types";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Paramètres de tracking à retirer de l'URL : ils varient d'un run/SERP à l'autre
// et casseraient sinon la stabilité de la clé.
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|mc_|ref$|ref_src$|igshid$|spm$|cmpid$|ito$|at_|ns_|__|s_)/i;

/**
 * URL canonique d'un signal : host (sans www) + chemin, paramètres de tracking
 * retirés, en minuscules. STABLE d'un run à l'autre pour un même article/post,
 * contrairement au titre (réécrit par Claude à chaque passage, donc non
 * déterministe). C'est la base de la clé de dédup quand une URL existe.
 */
function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.test(k))
      .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
      .sort();
    const query = params.length ? `?${params.join("&")}` : "";
    return `${host}${path}${query}`;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Clé de dédup déterministe d'un signal. Inclut l'identité société + une empreinte
 * stable de la source, pour que `ON CONFLICT (dedupe_key) DO NOTHING` ne ré-insère
 * jamais un signal déjà vu (même article/post/nomination), quel que soit le run.
 *
 * - article/post : société + URL canonique (PAS le titre : Claude le reformule à
 *   chaque run, ce qui changeait la clé et réinsérait le même signal en boucle).
 * - sans URL (people_move Apollo) : société + type + titre normalisé.
 *
 * Limite : deux URLs DIFFÉRENTES sur le même fait (2 médias, presse + repost)
 * donnent 2 clés et passent toutes les deux. Le `contentKey` ci-dessous attrape
 * ce cas en se basant sur le contenu (entités du fait), pas l'URL.
 */
export function dedupeKey(s: ScoredSignal): string {
  const company = norm(s.company_name) || norm(s.company_domain ?? "") || "unknown";
  const basis = s.url
    ? `${company}|${canonicalUrl(s.url)}`
    : `${company}|${s.signal_type}|${norm(s.title).slice(0, 90)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/**
 * Clé de dédup PAR CONTENU, indépendante de l'URL et de la source. Basée sur une
 * signature stable du fait émise par Claude (`dedupe_signature` : personne +
 * action + société, normalisée), pour bloquer la même info venue de 2 URLs
 * différentes. Renvoie `null` si aucune signature exploitable : on retombe alors
 * sur la seule `dedupeKey` (URL), sans rien bloquer à tort.
 */
export function contentKey(s: ScoredSignal): string | null {
  const sig = norm(s.dedupe_signature ?? "");
  if (sig.length < 6) return null;
  const company = norm(s.company_name) || norm(s.company_domain ?? "") || "unknown";
  return createHash("sha256").update(`${company}|${sig}`).digest("hex").slice(0, 32);
}

/**
 * Recouvrement de mots significatifs (> 3 lettres) entre deux titres, ramené à
 * [0,1] sur la plus petite des deux. Sert de filet anti-doublon flou quand le
 * `content_key` manque (anciennes lignes antérieures à la migration). Stable et
 * déterministe, contrairement à une comparaison plein-texte.
 */
export function titleOverlap(a: string, b: string): number {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 3));
  const wb = new Set(norm(b).split(" ").filter((w) => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.min(wa.size, wb.size);
}
