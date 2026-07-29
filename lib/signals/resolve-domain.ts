/**
 * Résolution du domaine officiel d'une société découverte — échelle du gratuit
 * vers le payant, premier succès gagnant.
 *
 * Pourquoi c'est critique : sans domaine, pas d'email deviné, donc pas de lead,
 * donc le signal est jeté. C'est le principal facteur du taux de survie du sweep.
 *
 * Apollo n'apparaît PAS dans l'échelle : People Search ne renvoie que le NOM de
 * l'organisation, jamais son domaine (vérifié sur l'API de prod). Le champ
 * `organization_domain` n'est peuplé que par /people/match.
 */

import { fetchSerp } from "@/lib/brightdata/serp";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";
import { companyDomainFromHubspot, normDomain } from "./email-pattern";
import { normCompany } from "./resolve-company";

export type DomainVia = "hubspot_scope" | "hubspot_name" | "article_host" | "serp" | null;

export interface DomainResult {
  domain: string | null;
  via: DomainVia;
}

/**
 * Hôtes qui ne sont JAMAIS le site d'une société sujet : médias, fils de
 * communiqués, agrégateurs, réseaux sociaux, plateformes de blog.
 *
 * C'est le garde-fou le plus important du module. Sans lui, l'étage "hôte de
 * l'article" rendrait `lesechos.fr` pour une bonne partie des signaux et on
 * fabriquerait des emails `prenom.nom@lesechos.fr` — un échec silencieux qui
 * envoie de vrais mails à de vraies mauvaises adresses.
 */
const PRESS_DOMAINS = new Set([
  "lesechos.fr", "lemonde.fr", "lefigaro.fr", "latribune.fr", "liberation.fr", "leparisien.fr",
  "usinenouvelle.com", "challenges.fr", "capital.fr", "bfmtv.com", "franceinfo.fr", "ouest-france.fr",
  "maddyness.com", "frenchweb.fr", "journaldunet.com", "lsa-conso.fr", "actionco.fr", "e-marketing.fr",
  "focusrh.com", "actuel-rh.fr", "parlonsrh.com", "courriercadres.com", "helloworkplace.fr",
  "techcrunch.com", "sifted.eu", "businessinsider.com", "forbes.com", "fortune.com", "ft.com",
  "reuters.com", "bloomberg.com", "cnbc.com", "wsj.com", "theguardian.com", "bbc.com", "bbc.co.uk",
  "businesswire.com", "prnewswire.com", "globenewswire.com", "newswire.ca", "presse-citron.net",
  "linkedin.com", "x.com", "twitter.com", "facebook.com", "instagram.com", "youtube.com",
  "msn.com", "yahoo.com", "finance.yahoo.com", "news.google.com", "google.com", "flipboard.com",
  "medium.com", "substack.com", "wordpress.com", "blogspot.com", "wikipedia.org",
  "handelsblatt.com", "faz.net", "welt.de", "spiegel.de", "manager-magazin.de",
  "elpais.com", "expansion.com", "cincodias.elpais.com", "corriere.it", "ilsole24ore.com",
  "nrc.nl", "fd.nl", "di.se", "dn.se", "borsen.dk", "e24.no",
]);

export function isPressDomain(domain: string | null): boolean {
  const d = normDomain(domain);
  if (!d) return true;
  if (PRESS_DOMAINS.has(d)) return true;
  // Sous-domaines de presse (ex. tech.lesechos.fr, edition.cnn.com).
  return [...PRESS_DOMAINS].some((p) => d.endsWith(`.${p}`));
}

/** Extrait l'hôte normalisé d'une URL. null si l'URL est inexploitable. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return normDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Le domaine ressemble-t-il au nom de la société ? Compare les formes
 * normalisées : "doctolib.fr" vs "Doctolib" → oui ; "lesechos.fr" vs "Doctolib"
 * → non. On exige un préfixe/suffixe, pas une simple inclusion de 3 lettres.
 */
function domainMatchesCompany(domain: string, companyName: string): boolean {
  const label = domain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  const comp = normCompany(companyName).replace(/\s+/g, "");
  if (!label || !comp || label.length < 3) return false;
  return label === comp || comp.startsWith(label) || label.startsWith(comp);
}

export interface DomainContext {
  /** Clé : nom de société normalisé. Évite de re-résoudre 3 fois la même boîte. */
  cache: Map<string, DomainResult>;
  /** Budget SERP du run, décrémenté. Borne dure du coût et de la latence. */
  serpBudget: { left: number };
}

export function newDomainContext(serpBudget = 30): DomainContext {
  return { cache: new Map(), serpBudget: { left: serpBudget } };
}

/**
 * Résout le domaine officiel d'une société, du gratuit vers le payant :
 *   1. compte watchlist déjà lié -> HubSpot (gratuit, le plus fiable)
 *   2. HubSpot par nom (fuzzy)
 *   3. hôte de l'article, SI il ressemble au nom et n'est pas un média
 *   4. SERP "<nom> site officiel", premier organique hors presse (payant, borné)
 */
export async function resolveCompanyDomain(
  params: { companyName: string; scopeCompanyId?: string | null; articleUrl?: string | null },
  ctx: DomainContext,
): Promise<DomainResult> {
  const key = normCompany(params.companyName);
  if (!key) return { domain: null, via: null };
  const cached = ctx.cache.get(key);
  if (cached) return cached;

  const result = await resolveUncached(params, ctx);
  ctx.cache.set(key, result);
  return result;
}

async function resolveUncached(
  params: { companyName: string; scopeCompanyId?: string | null; articleUrl?: string | null },
  ctx: DomainContext,
): Promise<DomainResult> {
  // 1. Compte watchlist déjà résolu vers HubSpot.
  if (params.scopeCompanyId) {
    try {
      const resolved = await resolveHubspotCompanyId(params.scopeCompanyId);
      const d = await companyDomainFromHubspot(resolved.hubspot_company_id);
      if (d && !isPressDomain(d)) return { domain: d, via: "hubspot_scope" };
    } catch {
      /* best-effort */
    }
  }

  // 2. HubSpot par nom (fuzzy Jaro-Winkler, aucune création).
  //    Le fuzzy seul ne suffit PAS ici : "CMS Energy" matche "So Energy" à 0,896
  //    (seuil 0,85) parce que le suffixe commun écrase le token discriminant, et
  //    on fabriquerait alors un email chez la mauvaise société. On exige donc en
  //    plus que le domaine trouvé ressemble au nom cherché. Contrairement à
  //    l'étage 1, où le lien compte->société HubSpot a été validé par un humain.
  try {
    const company = await findCompanyByName(params.companyName);
    if (company) {
      const d = await companyDomainFromHubspot(company.id);
      if (d && !isPressDomain(d) && domainMatchesCompany(d, params.companyName)) {
        return { domain: d, via: "hubspot_name" };
      }
    }
  } catch {
    /* best-effort */
  }

  // 3. Hôte de l'article : valable UNIQUEMENT quand l'article est publié sur le
  //    site de la société elle-même (communiqué de presse maison).
  const host = hostOf(params.articleUrl);
  if (host && !isPressDomain(host) && domainMatchesCompany(host, params.companyName)) {
    return { domain: host, via: "article_host" };
  }

  // 4. SERP, en dernier recours et sous budget.
  if (ctx.serpBudget.left > 0) {
    ctx.serpBudget.left--;
    const d = await domainFromSerp(params.companyName);
    if (d) return { domain: d, via: "serp" };
  }

  return { domain: null, via: null };
}

interface OrganicItem {
  link?: string;
  url?: string;
}

/**
 * Cherche le site officiel via la SERP. On ne garde un résultat que s'il n'est
 * pas un média ET que son domaine ressemble au nom de la société : mieux vaut
 * aucun domaine qu'un mauvais, puisqu'un mauvais domaine produit un email
 * plausible mais faux.
 */
async function domainFromSerp(companyName: string): Promise<string | null> {
  const q = `${companyName} site officiel`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&brd_json=1&num=10`;
  const r = await fetchSerp(url).catch(() => null);
  if (!r || !r.ok || !r.isJson) return null;
  const data = r.data as { organic?: OrganicItem[] } | null;
  for (const item of data?.organic ?? []) {
    const host = hostOf(item.link || item.url);
    if (!host || isPressDomain(host)) continue;
    if (domainMatchesCompany(host, companyName)) return host;
  }
  return null;
}
