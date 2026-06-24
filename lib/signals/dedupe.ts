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
 */
export function dedupeKey(s: ScoredSignal): string {
  const company = norm(s.company_name) || norm(s.company_domain ?? "") || "unknown";
  const basis = s.url
    ? `${company}|${canonicalUrl(s.url)}`
    : `${company}|${s.signal_type}|${norm(s.title).slice(0, 90)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
