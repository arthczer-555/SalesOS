/**
 * Enrichissement lead — le cœur de la refonte Signals.
 *
 * Règle produit : un signal n'entre dans le feed QUE si on sait déjà à qui écrire.
 * Ce module prend les signaux classés par score et descend le classement jusqu'à
 * en avoir 10 munis d'un lead joignable ; les autres sont jetés.
 *
 * Contrat de coût, strict :
 *   - le sweep de nuit ne dépense AUCUN crédit Apollo (People Search est gratuit),
 *   - l'email est DEVINÉ par pattern société,
 *   - le reveal payant (1 crédit) n'a lieu qu'au clic de l'utilisateur, dans act.ts.
 *
 * Contrainte d'API à connaître (vérifiée sur l'API de prod, cf. scripts/probe-apollo.ts) :
 * People Search masque le nom de famille (`last_name_obfuscated: "Bi***m"`) et ne
 * renvoie pas le domaine de la société. Un lead Apollo est donc RÉVÉLABLE mais son
 * email n'est pas DEVINABLE. D'où deux familles de leads :
 *   - nom complet + domaine  -> email deviné            (post_author, nominee, crm)
 *   - apollo_id seul         -> email à révéler au clic (apollo_icp)
 */

import Anthropic from "@anthropic-ai/sdk";
import { searchPeople as apolloSearchPeople, isApolloConfigured } from "@/lib/apollo/client";
import { anthropicClient } from "@/lib/anthropic-client";
import { logUsage } from "@/lib/log-usage";
import { fetchCompanyContacts } from "@/lib/watchlist/fetch-company-contacts";
import { guessEmail, samplesForDomain, type EmailSample } from "./email-pattern";
import { newDomainContext, resolveCompanyDomain, type DomainContext, type DomainVia } from "./resolve-domain";
import { mapLimit } from "./util";
import type { ScoredSignal } from "./types";

const NOMINEE_MODEL = "claude-haiku-4-5-20251001";

/** Titres et séniorités du buyer Coachello (RH / People / L&D). */
export const ICP_TITLES = ["CHRO", "DRH", "VP People", "Head of L&D", "People", "Talent", "HRBP", "Learning"];
export const ICP_SENIORITIES = ["c_suite", "vp", "head", "director"];
const ICP_KEYWORDS = [
  "chro", "drh", "ressources humaines", "human resources", "people", "talent",
  "l&d", "learning", "hrbp", "rh", "formation", "développement", "development",
];

export function isIcpTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").toLowerCase();
  return ICP_KEYWORDS.some((k) => t.includes(k));
}

export type LeadSource = "post_author" | "nominee" | "crm" | "apollo_icp";
export type EmailSource = "crm" | "pattern" | "guess" | "pending_reveal";

export interface SignalLead {
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  linkedin: string | null;
  /** Nécessaire pour révéler l'email au clic (1 crédit). */
  apollo_id: string | null;
  /** null quand `email_source === 'pending_reveal'`. */
  email: string | null;
  email_source: EmailSource;
  source: LeadSource;
}

export interface EnrichedSignal extends ScoredSignal {
  company_domain: string | null;
  domain_via: DomainVia;
  lead: SignalLead;
}

/** Raison pour laquelle un signal a été jeté — sert au diagnostic du taux de survie. */
export type DropReason = "no_domain" | "no_person" | "no_email";

export interface EnrichContext {
  domain: DomainContext;
  /** Échantillons d'emails par domaine (HubSpot, gratuit). */
  samples: Map<string, EmailSample[]>;
  /** Résultats People Search par société normalisée. */
  apollo: Map<string, { id: string; first: string | null; title: string | null }[]>;
  deadline: number;
  /** Compteur de diagnostics, agrégé par le sweep. */
  drops: Record<DropReason, number>;
}

export function newEnrichContext(opts: { deadlineMs?: number; serpBudget?: number } = {}): EnrichContext {
  return {
    domain: newDomainContext(opts.serpBudget ?? 30),
    samples: new Map(),
    apollo: new Map(),
    deadline: Date.now() + (opts.deadlineMs ?? 8 * 60_000),
    drops: { no_domain: 0, no_person: 0, no_email: 0 },
  };
}

// ── Extraction des personnes nommées dans l'article ──────────────────────────

export interface NomineePerson {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
}

const NOMINEE_TOOL: Anthropic.Tool = {
  name: "emit_nominees",
  description:
    "Renvoie la/les personne(s) citée(s) nommément dans le signal (nommée, promue, recrutée, ou dont la prise de poste est annoncée).",
  input_schema: {
    type: "object" as const,
    properties: {
      people: {
        type: "array",
        description: "Chaque personne explicitement nommée. Liste vide si aucune personne précise n'est citée.",
        items: {
          type: "object",
          properties: {
            first_name: { type: "string", description: "Prénom." },
            last_name: { type: "string", description: "Nom de famille." },
            title: { type: "string", description: "Nouveau poste/titre, ou vide." },
          },
          required: ["first_name", "last_name"],
        },
      },
    },
    required: ["people"],
  },
};

/**
 * Extrait les personnes citées nommément dans un signal (max 4). Une annonce peut
 * en citer plusieurs (ex : réorganisation de gouvernance nommant un COO ET une
 * DRH). Liste vide si aucune : c'est un résultat normal, pas une erreur.
 */
export async function extractNominees(sig: { title: string; summary: string | null }): Promise<NomineePerson[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const client = anthropicClient({ timeout: 30_000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: NOMINEE_MODEL,
    max_tokens: 400,
    system:
      "Tu extrais les personnes citées NOMMÉMENT qui sont nommées, promues, recrutées ou dont la prise de poste est annoncée dans un signal de prospection. Inclure chaque personne nommée (une réorganisation de gouvernance peut en citer plusieurs). N'invente aucun nom : uniquement des personnes explicitement citées par leur nom. Si aucune personne précise n'est citée (juste l'entreprise), renvoie une liste vide. Réponds uniquement via emit_nominees.",
    messages: [{ role: "user", content: `Titre: ${sig.title}\nRésumé: ${sig.summary ?? ""}` }],
    tools: [NOMINEE_TOOL],
    tool_choice: { type: "tool" as const, name: "emit_nominees" },
  });
  logUsage(null, NOMINEE_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "signals_nominee");
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return [];
  const out = block.input as { people?: { first_name?: string; last_name?: string; title?: string }[] };
  const result: NomineePerson[] = [];
  const seen = new Set<string>();
  for (const p of out.people ?? []) {
    const firstName = (p.first_name ?? "").trim();
    const lastName = (p.last_name ?? "").trim();
    if (!firstName && !lastName) continue;
    const k = `${firstName} ${lastName}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    result.push({ firstName: firstName || null, lastName: lastName || null, title: (p.title ?? "").trim() || null });
    if (result.length >= 4) break;
  }
  return result;
}

// ── Enrichissement d'un signal ───────────────────────────────────────────────

/** Découpe "Marie Durand" en prénom / nom. Renvoie null si un seul token. */
function splitName(full: string): { first: string; last: string } | null {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function samplesFor(domain: string | null, ctx: EnrichContext): Promise<EmailSample[]> {
  if (!domain) return [];
  const hit = ctx.samples.get(domain);
  if (hit) return hit;
  const s = await samplesForDomain(domain);
  ctx.samples.set(domain, s);
  return s;
}

/**
 * Trouve le lead d'un signal. Renvoie null si aucune personne joignable, auquel
 * cas le signal est jeté (décision produit : un signal sur lequel on ne peut pas
 * agir n'a pas sa place dans un feed de 10 cartes par jour).
 */
export async function enrichSignalLead(
  s: ScoredSignal,
  ctx: EnrichContext,
): Promise<EnrichedSignal | null> {
  const { domain, via } = await resolveCompanyDomain(
    { companyName: s.company_name, scopeCompanyId: s.scope_company_id, articleUrl: s.url },
    ctx.domain,
  );

  // On collecte TOUS les leads possibles puis on garde le meilleur, plutôt que de
  // s'arrêter au premier trouvé. Sans ça, un article de levée qui cite le CEO
  // donnerait le CEO comme lead alors qu'Apollo aurait la DRH : on écrirait à
  // Mark Zuckerberg pour parler de coaching de managers.
  const found: { lead: SignalLead; priority: number }[] = [];
  const samples = domain ? await samplesFor(domain, ctx) : [];
  const emailSourceForGuess: EmailSource = samples.length ? "pattern" : "guess";

  // Auteur d'un post LinkedIn : il EST le sujet du signal, rien ne prime dessus.
  // C'est aussi le canal le moins cher du pipeline (nom et profil déjà connus).
  if (s.author?.name && domain) {
    const parts = splitName(s.author.name);
    const email = parts ? guessEmail(parts.first, parts.last, samples, domain) : null;
    if (parts && email) {
      found.push({
        priority: 100,
        lead: {
          first_name: parts.first,
          last_name: parts.last,
          full_name: s.author.name,
          title: null,
          linkedin: s.author.linkedin,
          apollo_id: null,
          email,
          email_source: emailSourceForGuess,
          source: "post_author",
        },
      });
    }
  }

  // Personnes nommées dans l'article. Une DRH nommée est le meilleur lead qui
  // soit ; un COO nommé dans la même annonce ne vaut qu'en dernier recours.
  if (domain && s.signal_type !== "linkedin_post") {
    const nominees = await extractNominees(s).catch(() => [] as NomineePerson[]);
    for (const n of nominees) {
      if (!n.firstName || !n.lastName) continue;
      const email = guessEmail(n.firstName, n.lastName, samples, domain);
      if (!email) continue;
      found.push({
        priority: isIcpTitle(n.title) ? 90 : 40,
        lead: {
          first_name: n.firstName,
          last_name: n.lastName,
          full_name: `${n.firstName} ${n.lastName}`,
          title: n.title,
          linkedin: null,
          apollo_id: null,
          email,
          email_source: emailSourceForGuess,
          source: "nominee",
        },
      });
    }
  }

  // Contact HubSpot du compte : email RÉEL (jamais de reveal dessus).
  if (s.scope_company_id) {
    const contacts = await fetchCompanyContacts(s.scope_company_id).catch(() => null);
    for (const c of contacts?.contacts ?? []) {
      if (!c.email?.includes("@")) continue;
      found.push({
        priority: isIcpTitle(c.jobtitle) ? 80 : 30,
        lead: {
          first_name: c.firstname ?? null,
          last_name: c.lastname ?? null,
          full_name: [c.firstname, c.lastname].filter(Boolean).join(" ").trim() || c.email,
          title: c.jobtitle ?? null,
          linkedin: null,
          apollo_id: null,
          email: c.email,
          email_source: "crm",
          source: "crm",
        },
      });
    }
  }

  // Apollo ICP : ciblé RH par construction, mais l'API masque le nom de famille,
  // donc pas d'email devinable. On garde l'id : un clic (1 crédit) révélera nom
  // et email réels. Passe devant un nominé hors ICP, qui n'est pas notre acheteur.
  if (isApolloConfigured() && s.company_name) {
    const people = await apolloIcp(s.company_name, domain, ctx);
    const best = people.find((p) => isIcpTitle(p.title)) ?? people[0];
    if (best) {
      found.push({
        priority: isIcpTitle(best.title) ? 70 : 50,
        lead: {
          first_name: best.first,
          last_name: null,
          full_name: best.first ? `${best.first} (nom à révéler)` : "Contact à révéler",
          title: best.title,
          linkedin: null,
          apollo_id: best.id,
          email: null,
          email_source: "pending_reveal",
          source: "apollo_icp",
        },
      });
    }
  }

  const winner = found.sort((a, b) => b.priority - a.priority)[0];
  if (!winner) {
    // Diagnostic du rejet : distingue "pas de domaine" de "personne introuvable",
    // les deux appelant des correctifs très différents.
    ctx.drops[domain ? "no_person" : "no_domain"]++;
    return null;
  }
  return { ...s, company_domain: domain, domain_via: via, lead: winner.lead };
}

async function apolloIcp(
  companyName: string,
  domain: string | null,
  ctx: EnrichContext,
): Promise<{ id: string; first: string | null; title: string | null }[]> {
  const key = `${companyName.toLowerCase()}|${domain ?? ""}`;
  const hit = ctx.apollo.get(key);
  if (hit) return hit;
  // Le domaine filtre bien plus précisément que le nom (homonymes de sociétés).
  const search = await apolloSearchPeople({
    ...(domain ? { domain } : { organizationName: companyName }),
    titles: ICP_TITLES,
    seniorities: ICP_SENIORITIES,
    perPage: 10,
  }).catch(() => null);
  const out = (search?.people ?? [])
    .filter((p) => p.id)
    .map((p) => ({ id: p.id, first: p.first_name, title: p.title }));
  ctx.apollo.set(key, out);
  return out;
}

// ── Boucle de descente ───────────────────────────────────────────────────────

/**
 * Enrichit par vagues, en descendant le classement jusqu'à `target` signaux munis
 * d'un lead. Les vagues (plutôt que du séquentiel) sont indispensables : un
 * candidat coûte 3-6 s en régime normal mais jusqu'à 25 s si le SERP de secours
 * part en timeout, ce qui suffirait à faire exploser les 15 min de la Background
 * Function sur une trentaine de candidats.
 */
export async function enrichUntilTarget(
  ranked: ScoredSignal[],
  opts: {
    target?: number;
    waveSize?: number;
    concurrency?: number;
    maxAttempts?: number;
    ctx?: EnrichContext;
  } = {},
): Promise<{ enriched: EnrichedSignal[]; attempts: number; ctx: EnrichContext }> {
  const target = opts.target ?? 10;
  const waveSize = opts.waveSize ?? 12;
  const concurrency = opts.concurrency ?? 4;
  const maxAttempts = opts.maxAttempts ?? 36;
  const ctx = opts.ctx ?? newEnrichContext();

  const kept: EnrichedSignal[] = [];
  let attempts = 0;

  for (let i = 0; i < ranked.length && kept.length < target && attempts < maxAttempts; i += waveSize) {
    if (Date.now() > ctx.deadline) {
      console.warn("[signals/enrich] deadline atteinte, arrêt de la descente");
      break;
    }
    const wave = ranked.slice(i, Math.min(i + waveSize, i + (maxAttempts - attempts)));
    attempts += wave.length;
    const out = await mapLimit(wave, concurrency, (s) =>
      enrichSignalLead(s, ctx).catch((e) => {
        console.warn("[signals/enrich] échec:", e instanceof Error ? e.message : e);
        return null;
      }),
    );
    kept.push(...out.filter((x): x is EnrichedSignal => x !== null));
  }

  return {
    enriched: kept.sort((a, b) => b.score - a.score).slice(0, target),
    attempts,
    ctx,
  };
}
