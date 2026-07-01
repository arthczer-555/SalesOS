import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { fetchCompanyContacts } from "@/lib/watchlist/fetch-company-contacts";
import { draftProspectionEmail, type DraftRecipient } from "@/lib/watchlist/draft-email";
import { searchPeople as apolloSearchPeople, revealPerson, isApolloConfigured } from "@/lib/apollo/client";
import { searchPeople as searchLinkedinPeople } from "@/lib/brightdata/linkedin";
import { hubspotFetch, hubspotAssociate, createCompany } from "@/lib/hubspot";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";
import type { SignalRow, SignalCandidate, SignalAuthor } from "./types";

// Mots-clés ICP pour reconnaître un bon contact (buyer RH / People / L&D).
const ICP_KEYWORDS = ["chro", "drh", "ressources humaines", "human resources", "people", "talent", "l&d", "learning", "hrbp", "rh", "formation"];
const ICP_TITLES = ["CHRO", "DRH", "VP People", "Head of L&D", "People", "Talent", "HRBP", "Learning"];
const ICP_SENIORITIES = ["c_suite", "vp", "head", "director"];

function isIcp(title: string | null | undefined): boolean {
  const t = (title ?? "").toLowerCase();
  return ICP_KEYWORDS.some((k) => t.includes(k));
}

export interface CandidatesResult {
  signal: SignalRow | null;
  scopeCompanyId: string | null;
  candidates: SignalCandidate[];
  apolloConfigured: boolean;
}

/** Personne clé citée dans un signal (nominé) ou auteur d'un post LinkedIn. */
interface NomineePerson {
  firstName: string;
  lastName: string;
  title: string | null;
}

/**
 * Prépare la liste des destinataires possibles pour un signal SANS rien dépenser
 * (pas de reveal, pas de draft) : contacts CRM du compte + candidats ICP Apollo
 * (emails masqués). L'utilisateur choisit ensuite qui contacter. Rangés : ICP CRM
 * d'abord, puis CRM, puis Apollo par séniorité.
 */
export async function getSignalCandidates(signalId: string): Promise<CandidatesResult> {
  const { data: sig } = await db.from("prospect_signals").select("*").eq("id", signalId).maybeSingle<SignalRow>();
  if (!sig) return { signal: null, scopeCompanyId: null, candidates: [], apolloConfigured: isApolloConfigured() };

  // Post LinkedIn discovery : l'auteur EST la cible. On résout d'abord sa vraie
  // société (la company_name stockée n'est qu'un fallback = nom de l'auteur) pour
  // que la recherche de collègues ICP + l'ajout watchlist portent sur le bon compte.
  let authorFocus: NomineePerson | null = null;
  if (sig.signal_type === "linkedin_post") {
    const resolved = await resolvePostAuthor(sig).catch(() => null);
    if (resolved) {
      authorFocus = { firstName: resolved.firstName ?? "", lastName: resolved.lastName ?? "", title: resolved.title };
      if (resolved.companyName && resolved.companyName.toLowerCase() !== sig.company_name.toLowerCase()) {
        sig.company_name = resolved.companyName;
        await db
          .from("prospect_signals")
          .update({ company_name: resolved.companyName, updated_at: new Date().toISOString() })
          .eq("id", sig.id);
      }
    }
  }

  const out: SignalCandidate[] = [];
  const seenNames = new Set<string>();
  // Échantillons (prénom, nom, email) pour deviner le pattern d'emails société.
  const samples: { first: string; last: string; email: string }[] = [];
  // Domaine officiel de la société (HubSpot) : ancre l'email deviné sur le BON
  // domaine et écarte les contacts d'une autre entité (maison-mère/sœur) qui
  // pollueraient le pattern (ex: Kerria AM vs atland.fr).
  let companyDomain: string | null = null;

  // Contacts CRM (si le compte est déjà dans la watchlist). On inclut AUSSI les
  // contacts dont l'email n'est pas encore révélé (bouton "Reveal" sur la fiche) :
  // ils restent sélectionnables, l'email sera révélé (Apollo par nom) ou deviné
  // (pattern société) au moment du draft.
  if (sig.scope_company_id) {
    const { hubspot_company_id, contacts } = await fetchCompanyContacts(sig.scope_company_id).catch(() => ({
      hubspot_company_id: null,
      contacts: [],
    }));
    companyDomain = await companyDomainFromHubspot(hubspot_company_id);
    // Pattern d'emails connus (contacts déjà révélés) -> sert à deviner les autres.
    // On n'apprend QUE sur les contacts du domaine officiel quand il est connu,
    // pour ne pas inférer un domaine étranger à la société.
    for (const c of contacts) {
      if (c.email && c.firstname && c.lastname && emailMatchesDomain(c.email, companyDomain)) {
        samples.push({ first: c.firstname, last: c.lastname, email: c.email });
      }
    }
    for (const c of contacts) {
      const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "";
      if (!name || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());
      out.push({
        key: `crm:${c.id}`,
        source: "crm",
        name,
        title: c.jobtitle,
        email: c.email,
        apolloId: null,
        icp: isIcp(c.jobtitle),
        // Sans email : reveal Apollo par nom au draft, email deviné en secours.
        firstName: c.firstname ?? null,
        lastName: c.lastname ?? null,
        guessEmail: c.email ? null : guessEmail(c.firstname ?? undefined, c.lastname ?? undefined, samples, companyDomain),
      });
    }
  }

  // Candidats Apollo ICP (emails masqués, reveal à la demande).
  const apolloPeople: { id: string; first: string; last: string }[] = [];
  if (isApolloConfigured() && sig.company_name) {
    const search = await apolloSearchPeople({
      organizationName: sig.company_name,
      titles: ICP_TITLES,
      seniorities: ICP_SENIORITIES,
      perPage: 10,
    }).catch(() => null);
    for (const p of search?.people ?? []) {
      const name = (p.name || `${p.first_name ?? ""} ${p.last_name ?? ""}`).trim();
      if (!name || !p.id || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());
      if (p.first_name && p.last_name) apolloPeople.push({ id: p.id, first: p.first_name, last: p.last_name });
      out.push({
        key: `apollo:${p.id}`,
        source: "apollo",
        name,
        title: p.title,
        email: null,
        apolloId: p.id,
        icp: isIcp(p.title) || ICP_SENIORITIES.includes((p.seniority ?? "").toLowerCase()),
      });
    }
  }

  // Tri : ICP CRM > CRM > Apollo ICP > Apollo, l'ICP toujours devant.
  const rank = (c: SignalCandidate) => {
    let r = 0;
    if (c.source === "crm") r += 2;
    if (c.icp) r += 4;
    return r;
  };
  out.sort((a, b) => rank(b) - rank(a));

  // FOCUS sur la/les personne(s) clé(s) du signal, mise(s) en tête. Pour un post
  // LinkedIn, c'est l'auteur (authorFocus). Sinon, on extrait la/les personne(s)
  // nommée(s)/promue(s)/recrutée(s) citée(s), QUEL QUE SOIT le type de signal :
  // une arrivée de dirigeant peut être qualifiée "nomination" mais AUSSI
  // "restructuring"/"expansion"/"hiring" (ex : réorganisation de gouvernance qui
  // nomme une nouvelle DRH). Haiku renvoie une liste vide si personne n'est nommé.
  // Email résolu au draft (reveal Apollo par nom), email DEVINÉ en secours (pattern
  // société). Si plusieurs personnes, l'ICP RH/People est priorisée et pré-cochée.
  let candidates = out;
  const nominees: NomineePerson[] = authorFocus
    ? [authorFocus]
    : sig.signal_type === "linkedin_post"
      ? []
      : await extractNominees(sig).catch(() => []);
  const validNominees = nominees.filter((n) => n.firstName || n.lastName);
  if (validNominees.length > 0) {
    // Pas de contact CRM pour apprendre le pattern d'emails ? On révèle UN collègue
    // ICP via Apollo (1 crédit) pour comprendre la structure des emails de la
    // société, puis on devine l'email des nominés.
    if (samples.length === 0 && apolloPeople.length > 0 && isApolloConfigured()) {
      const learned = await learnEmailPattern(apolloPeople, out);
      if (learned) samples.push(learned);
    }
    // ICP RH/People en tête : c'est notre buyer prioritaire (ex : la DRH nommée
    // passe devant le COO nommé dans la même annonce).
    const ranked = [...validNominees].sort((a, b) => Number(isIcp(b.title)) - Number(isIcp(a.title)));
    const focusCandidates: SignalCandidate[] = [];
    for (const [i, nominee] of ranked.entries()) {
      const full = `${nominee.firstName ?? ""} ${nominee.lastName ?? ""}`.trim();
      if (!full || seenNames.has(full.toLowerCase())) continue;
      seenNames.add(full.toLowerCase());
      const guess = guessEmail(nominee.firstName, nominee.lastName, samples, companyDomain);
      // Évite un doublon si déjà présent (CRM/Apollo) : on le remonte en focus.
      const dupIdx = candidates.findIndex((c) => c.name.toLowerCase() === full.toLowerCase());
      if (dupIdx >= 0) candidates.splice(dupIdx, 1);
      focusCandidates.push({
        key: `nominee:${i}`,
        source: "nominee",
        name: full,
        title: nominee.title ?? null,
        email: guess,
        apolloId: null,
        icp: true,
        focus: true,
        guessed: !!guess,
        firstName: nominee.firstName ?? null,
        lastName: nominee.lastName ?? null,
        guessEmail: guess,
      });
    }
    candidates = [...focusCandidates, ...candidates];
  }

  return {
    signal: sig,
    scopeCompanyId: sig.scope_company_id,
    candidates: candidates.slice(0, 12),
    apolloConfigured: isApolloConfigured(),
  };
}

// ── Extraction de la personne nommée + devinette d'email ─────────────────────

const NOMINEE_MODEL = "claude-haiku-4-5-20251001";

const NOMINEE_TOOL: Anthropic.Tool = {
  name: "emit_nominees",
  description: "Renvoie la/les personne(s) citée(s) nommément dans le signal (nommée, promue, recrutée, ou dont la prise de poste est annoncée).",
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
 * Extrait la/les personne(s) nommée(s), promue(s) ou recrutée(s) citée(s)
 * nommément dans un signal (max 4). Une annonce peut en citer plusieurs (ex :
 * réorganisation de gouvernance nommant un COO ET une DRH). Liste vide si aucune.
 */
async function extractNominees(sig: SignalRow): Promise<NomineePerson[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
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
    result.push({ firstName, lastName, title: (p.title ?? "").trim() || null });
    if (result.length >= 4) break;
  }
  return result;
}

// ── Posts LinkedIn discovery : résolution de l'auteur -> société + contact ───

interface ResolvedAuthor {
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  /** Société actuelle de l'auteur (résolue via son profil), ou null. */
  companyName: string | null;
}

const AUTHOR_TOOL: Anthropic.Tool = {
  name: "emit_author_company",
  description: "Renvoie la société actuelle et le poste de l'auteur d'un post LinkedIn, déduits de son intitulé de profil (headline) et du post.",
  input_schema: {
    type: "object" as const,
    properties: {
      company: { type: "string", description: "Nom de la société actuelle (employeur) de l'auteur, ou vide si indéterminable." },
      title: { type: "string", description: "Poste actuel de l'auteur, ou vide." },
    },
    required: ["company"],
  },
};

/**
 * Extrait la société (employeur) + le poste d'un auteur de post LinkedIn à partir
 * de son headline de profil (récupéré en SERP) et du texte du post. Haiku, robuste
 * aux formats variés ("Title at Company", "Poste, Société", "X | Y"). null si rien.
 */
async function extractAuthorCompany(
  authorName: string,
  headline: string,
  postSummary: string,
): Promise<{ company: string | null; title: string | null } | null> {
  if (!process.env.ANTHROPIC_API_KEY || (!headline && !postSummary)) return null;
  const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: NOMINEE_MODEL,
    max_tokens: 150,
    system: "Tu déduis l'employeur ACTUEL et le poste d'une personne à partir de son intitulé de profil LinkedIn et d'un extrait de son post. Si la société n'est pas clairement identifiable, renvoie company vide. Pas d'invention. Réponds uniquement via emit_author_company.",
    messages: [{ role: "user", content: `Auteur: ${authorName}\nHeadline LinkedIn: ${headline || "(inconnu)"}\nExtrait du post: ${postSummary || "(aucun)"}` }],
    tools: [AUTHOR_TOOL],
    tool_choice: { type: "tool" as const, name: "emit_author_company" },
  });
  logUsage(null, NOMINEE_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "signals_author");
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return null;
  const out = block.input as { company?: string; title?: string };
  const company = (out.company ?? "").trim();
  const title = (out.title ?? "").trim();
  return { company: company || null, title: title || null };
}

/**
 * Résout l'auteur d'un post LinkedIn discovery : son nom est connu (payload), on
 * récupère son headline de profil via SERP (rapide), puis on en déduit sa société
 * + poste via Haiku. Best-effort : society null si indéterminable (le draft reste
 * possible, mais sans ajout watchlist fiable).
 */
async function resolvePostAuthor(sig: SignalRow): Promise<ResolvedAuthor | null> {
  const payload = sig.payload as { author?: SignalAuthor } | null;
  const author = payload?.author;
  if (!author?.name) return null;

  const parts = author.name.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  const slug = author.linkedin.match(/\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? "";

  // Headline via SERP (site:linkedin.com/in) : on privilégie le profil dont le
  // slug correspond à celui du post, sinon le premier résultat.
  const search = await searchLinkedinPeople({ firstName, lastName }).catch(() => null);
  const items = search?.data.items ?? [];
  const match = items.find((i) => i.username === slug) ?? items[0];
  const headline = match?.headline ?? "";

  const extracted = await extractAuthorCompany(author.name, headline, sig.summary ?? "").catch(() => null);
  return {
    name: author.name,
    firstName: firstName || null,
    lastName: lastName || null,
    title: extracted?.title ?? (headline || null),
    companyName: extracted?.company ?? null,
  };
}

/**
 * Révèle un collègue ICP via Apollo (1 crédit) pour APPRENDRE le pattern d'emails
 * de la société quand on n'a aucun contact CRM. Met aussi à jour l'email de ce
 * candidat dans la liste (il devient joignable). Renvoie l'échantillon ou null.
 */
async function learnEmailPattern(
  people: { id: string; first: string; last: string }[],
  out: SignalCandidate[],
): Promise<{ first: string; last: string; email: string } | null> {
  for (const p of people.slice(0, 3)) {
    const revealed = await revealPerson({ apolloId: p.id }).catch(() => null);
    const email = revealed?.person?.email;
    if (email && !email.includes("email_not_unlocked") && email.includes("@")) {
      const cand = out.find((c) => c.apolloId === p.id);
      if (cand) {
        cand.email = email;
        cand.source = "crm"; // a maintenant un vrai email -> plus de reveal
        cand.apolloId = null;
      }
      return { first: p.first, last: p.last, email };
    }
  }
  return null;
}

function nameNorm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalise un domaine (retire protocole, www, chemin, casse). */
function normDomain(raw: string | null | undefined): string | null {
  const d = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d || null;
}

/** L'email est-il sur le domaine attendu ? true si aucun domaine de référence. */
function emailMatchesDomain(email: string, domain: string | null): boolean {
  if (!domain) return true;
  const at = email.indexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1).toLowerCase() === domain;
}

/**
 * Domaine officiel de la société depuis HubSpot (propriété `domain`). null si
 * indisponible. Best-effort : ne bloque jamais le flux candidats.
 */
async function companyDomainFromHubspot(hubspotCompanyId: string | null): Promise<string | null> {
  if (!hubspotCompanyId) return null;
  try {
    const res = await hubspotFetch<{ properties?: { domain?: string } }>(
      `/crm/v3/objects/companies/${hubspotCompanyId}?properties=domain`,
    );
    return normDomain(res.properties?.domain);
  } catch {
    return null;
  }
}

/**
 * Devine l'email d'une personne d'après le pattern d'emails connus de la société
 * (échantillons prénom/nom/email). Détecte le format (first.last, flast, ...) sur
 * un échantillon puis l'applique. `preferredDomain` (domaine officiel de la
 * société) prime TOUJOURS sur le domaine des échantillons, pour ne pas deviner un
 * email sur un domaine étranger (ex: maison-mère). null si indéterminable.
 */
function guessEmail(
  firstNameRaw: string | undefined,
  lastNameRaw: string | undefined,
  samples: { first: string; last: string; email: string }[],
  preferredDomain?: string | null,
): string | null {
  const first = nameNorm(firstNameRaw ?? "");
  const last = nameNorm(lastNameRaw ?? "");
  if (!first && !last) return null;
  const anchor = normDomain(preferredDomain);
  if (samples.length === 0 && !anchor) return null;

  const templates: { id: string; fn: (f: string, l: string) => string }[] = [
    { id: "first.last", fn: (f, l) => `${f}.${l}` },
    { id: "firstlast", fn: (f, l) => `${f}${l}` },
    { id: "flast", fn: (f, l) => `${f.slice(0, 1)}${l}` },
    { id: "first_last", fn: (f, l) => `${f}_${l}` },
    { id: "f.last", fn: (f, l) => `${f.slice(0, 1)}.${l}` },
    { id: "first.l", fn: (f, l) => `${f}.${l.slice(0, 1)}` },
    { id: "lastfirst", fn: (f, l) => `${l}${f}` },
    { id: "first", fn: (f) => f },
    { id: "last", fn: (_f, l) => l },
  ];

  for (const s of samples) {
    const sf = nameNorm(s.first);
    const sl = nameNorm(s.last);
    const at = s.email.indexOf("@");
    if (at < 1 || !sf || !sl) continue;
    const local = s.email.slice(0, at).toLowerCase();
    const sampleDomain = s.email.slice(at + 1).toLowerCase();
    const match = templates.find((t) => t.fn(sf, sl) === local);
    if (match && first && last) {
      const domain = anchor ?? sampleDomain;
      if (domain) return `${match.fn(first, last)}@${domain}`;
    }
  }
  // Pas de pattern reconnu : on retombe sur first.last si on a un domaine fiable
  // (domaine officiel prioritaire, sinon un domaine unique partagé par les samples).
  if (first && last) {
    const sampleDomains = new Set(samples.map((s) => s.email.split("@")[1]?.toLowerCase()).filter(Boolean));
    const domain = anchor ?? (sampleDomains.size === 1 ? [...sampleDomains][0] : null);
    if (domain) return `${first}.${last}@${domain}`;
  }
  return null;
}

export interface SignalChoice {
  email?: string | null;
  name?: string | null;
  apolloId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Email deviné, utilisé si le reveal Apollo échoue (focus nominé). */
  fallbackEmail?: string | null;
}

export interface DraftForSignalResult {
  ok: boolean;
  recipients: DraftRecipient[];
  draft: { subject: string; body: string } | null;
  scopeCompanyId: string | null;
  apolloUsed: boolean;
  error?: string;
}

/**
 * Résout l'email d'UN destinataire choisi : email connu, sinon reveal Apollo (1
 * crédit, par id ou par nom), sinon email deviné en secours. Pousse le contact
 * révélé vers HubSpot (best-effort). Renvoie null si rien n'est joignable.
 */
async function resolveChoiceRecipient(
  c: SignalChoice,
  sig: SignalRow,
  scopeCompanyId: string,
): Promise<{ recipient: DraftRecipient | null; apolloUsed: boolean }> {
  if (c.email) return { recipient: { name: c.name ?? null, email: c.email }, apolloUsed: false };

  if (isApolloConfigured() && (c.apolloId || (c.firstName && c.lastName))) {
    const revealed = await revealPerson(
      c.apolloId
        ? { apolloId: c.apolloId }
        : { firstName: c.firstName!, lastName: c.lastName!, organizationName: sig.company_name },
    ).catch(() => null);
    const email = revealed?.person?.email;
    if (email && !email.includes("email_not_unlocked")) {
      const name = (revealed?.person?.name || c.name || "").trim() || null;
      const { hubspot_company_id } = await fetchCompanyContacts(scopeCompanyId).catch(() => ({ hubspot_company_id: null }));
      void pushContactToHubspot({
        hubspotCompanyId: hubspot_company_id,
        email,
        firstName: revealed?.person?.first_name ?? c.firstName ?? null,
        lastName: revealed?.person?.last_name ?? c.lastName ?? null,
        title: revealed?.person?.title ?? null,
      });
      return { recipient: { name, email }, apolloUsed: true };
    }
    // Secours : email deviné si Apollo n'a rien révélé.
    if (c.fallbackEmail) return { recipient: { name: c.name ?? null, email: c.fallbackEmail }, apolloUsed: true };
    return { recipient: null, apolloUsed: true };
  }

  if (c.fallbackEmail) return { recipient: { name: c.name ?? null, email: c.fallbackEmail }, apolloUsed: false };
  return { recipient: null, apolloUsed: false };
}

/**
 * Génère le brouillon pour le(s) destinataire(s) CHOISI(s) par l'utilisateur.
 * Révèle l'email via Apollo (1 crédit) seulement si un candidat n'en a pas déjà
 * un. En multi-destinataires, génère UN brouillon avec le token [first name]
 * (envoi personnalisé, un mail par personne côté client). Marque le signal
 * 'actioned' et stocke le brouillon (visible sur la fiche).
 */
export async function draftForSignal(params: {
  signalId: string;
  userId: string;
  userEmail?: string | null;
  choices: SignalChoice[];
  /** Force le mode personnalisé (token [first name]). Auto si plusieurs destinataires. */
  personalized?: boolean;
}): Promise<DraftForSignalResult> {
  const { data: sig } = await db.from("prospect_signals").select("*").eq("id", params.signalId).maybeSingle<SignalRow>();
  if (!sig) return { ok: false, recipients: [], draft: null, scopeCompanyId: null, apolloUsed: false, error: "Signal not found" };

  // Assurer un compte watchlist (discovery -> ajout) + société HubSpot. Pour un
  // post LinkedIn, résout d'abord la vraie société de l'auteur (sig.company_name
  // peut encore être un fallback si l'utilisateur n'est pas passé par /candidates).
  let scopeCompanyId = sig.scope_company_id;
  if (!scopeCompanyId) {
    scopeCompanyId = await ensureScopeCompanyForSignal(sig, params.userId);
  }

  const choices = params.choices.length ? params.choices : [{} as SignalChoice];
  const multi = choices.length > 1;
  const personalized = params.personalized ?? multi;

  // Résoudre l'email de chaque destinataire choisi (dédup sur l'email).
  let apolloUsed = false;
  const recipients: DraftRecipient[] = [];
  const seenEmails = new Set<string>();
  for (const c of choices) {
    const { recipient, apolloUsed: used } = await resolveChoiceRecipient(c, sig, scopeCompanyId);
    if (used) apolloUsed = true;
    if (recipient && !seenEmails.has(recipient.email.toLowerCase())) {
      seenEmails.add(recipient.email.toLowerCase());
      recipients.push(recipient);
    }
  }

  // Rédiger (ancré sur le signal). Même sans destinataire on génère un brouillon générique.
  // - Multi : un seul brouillon convenant à tous, salutation au token [first name].
  // - Solo nominé : on s'adresse directement à la personne (félicitations + prise de poste).
  // - Solo auteur de post : on rebondit sur le sujet de son post.
  // - Sinon : buyer RH à propos du changement dans la société.
  const single = choices[0];
  const recipientIsNominee = !multi && !!(single.firstName && single.lastName);
  const signalBase = `Signal déclencheur (${sig.signal_type}) : ${sig.title}${sig.summary ? ` - ${sig.summary}` : ""}.`;
  let signalLine: string;
  if (multi) {
    signalLine = `${signalBase} Tu écris à plusieurs décideurs RH/People de la même société à propos de ce signal. Ancre l'accroche sur ce signal précis et l'angle coaching/leadership. Le mail doit convenir à chacun : ne mentionne ni le nom ni le rôle d'une personne en particulier.`;
  } else if (sig.signal_type === "linkedin_post" && recipientIsNominee) {
    signalLine = `${signalBase} Le destinataire EST l'auteur de ce post LinkedIn (${recipients[0]?.name ?? `${single.firstName} ${single.lastName}`}). Rebondis directement et sincèrement sur le sujet de son post, montre que tu l'as lu, puis fais le lien avec un accompagnement coaching/leadership pertinent. Pas de flagornerie, pas de félicitations hors sujet.`;
  } else if (recipientIsNominee) {
    signalLine = `${signalBase} Le destinataire EST la personne concernée par ce signal (${recipients[0]?.name ?? `${single.firstName} ${single.lastName}`}). Adresse-toi directement à elle : félicite-la brièvement pour sa prise de poste, puis propose un accompagnement coaching/leadership pour réussir ses premiers mois et embarquer ses équipes. Pas de flagornerie.`;
  } else {
    signalLine = `${signalBase} Ancre l'accroche du mail sur ce signal précis et l'angle coaching/leadership pertinent pour le destinataire.`;
  }
  const draft = await draftProspectionEmail({
    scopeCompanyId,
    userId: params.userId,
    userEmail: params.userEmail,
    instructions: signalLine,
    recipients,
    personalized,
  });

  // Marquer actioned + stocker. Si la rédaction a ÉCHOUÉ, on NE marque PAS le
  // signal actioned : il resterait sinon hors du feed sans brouillon exploitable,
  // l'utilisateur ne pourrait plus réessayer. On garde 'new' mais on conserve le
  // destinataire/scope résolus pour qu'un nouvel essai ne re-dépense pas Apollo.
  const draftFailed = !!draft.error;
  const actionedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("prospect_signals")
    .update({
      scope_company_id: scopeCompanyId,
      feed: "watchlist",
      status: draftFailed ? "new" : "actioned",
      actioned_at: draftFailed ? null : actionedAt,
      draft_subject: draftFailed ? null : draft.subject,
      draft_body: draftFailed ? null : draft.body,
      // Aperçu sur la fiche : premier destinataire (le corps reste mutualisé).
      draft_recipient: recipients[0] ?? null,
      updated_at: actionedAt,
    })
    .eq("id", sig.id);
  if (updateError) {
    console.error("[signals/act] draft persist error:", updateError.message);
    return { ok: false, recipients, draft: null, scopeCompanyId, apolloUsed, error: updateError.message };
  }

  return {
    ok: !draftFailed,
    recipients,
    draft: draftFailed ? null : { subject: draft.subject, body: draft.body },
    scopeCompanyId,
    apolloUsed,
    error: draft.error,
  };
}

/**
 * "S'en occuper plus tard" : ajoute la société à la watchlist (si discovery),
 * rattache le signal et le marque actioned, SANS générer de brouillon. Le signal
 * sort du feed et reste visible sur la fiche compte.
 */
export async function saveSignalToWatchlist(params: {
  signalId: string;
  userId: string;
}): Promise<{ ok: boolean; scopeCompanyId: string | null; error?: string }> {
  const { data: sig } = await db.from("prospect_signals").select("*").eq("id", params.signalId).maybeSingle<SignalRow>();
  if (!sig) return { ok: false, scopeCompanyId: null, error: "Signal not found" };

  let scopeCompanyId = sig.scope_company_id;
  if (!scopeCompanyId) scopeCompanyId = await ensureScopeCompanyForSignal(sig, params.userId);

  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from("prospect_signals")
    .update({
      scope_company_id: scopeCompanyId,
      feed: "watchlist",
      status: "actioned",
      actioned_at: now,
      updated_at: now,
    })
    .eq("id", sig.id);
  if (updateError) {
    console.error("[signals/act] save persist error:", updateError.message);
    return { ok: false, scopeCompanyId, error: updateError.message };
  }

  return { ok: true, scopeCompanyId };
}

/**
 * Garantit un compte watchlist pour un signal (discovery -> ajout). Pour un post
 * LinkedIn, la société stockée n'est qu'un fallback (nom de l'auteur) : on résout
 * d'abord la vraie société de l'auteur, on la persiste, puis on l'ajoute.
 */
async function ensureScopeCompanyForSignal(sig: SignalRow, userId: string): Promise<string> {
  let companyName = sig.company_name;
  const payload = sig.payload as { author?: SignalAuthor } | null;
  const author = payload?.author;
  const unresolvedPost =
    sig.signal_type === "linkedin_post" &&
    !!author?.name &&
    companyName.trim().toLowerCase() === author.name.trim().toLowerCase();
  if (unresolvedPost) {
    const resolved = await resolvePostAuthor(sig).catch(() => null);
    if (resolved?.companyName) {
      companyName = resolved.companyName;
      await db
        .from("prospect_signals")
        .update({ company_name: companyName, updated_at: new Date().toISOString() })
        .eq("id", sig.id);
      sig.company_name = companyName;
    }
  }
  return ensureScopeCompany(companyName, sig.title, userId);
}

/**
 * Garantit la row scope_companies (par nom) ET la société HubSpot correspondante
 * (lien existant via fuzzy match, sinon création). Retourne l'id scope_companies.
 */
async function ensureScopeCompany(companyName: string, noteTitle: string, userId: string): Promise<string> {
  const name = companyName.trim();
  const { data: existing } = await db.from("scope_companies").select("id").ilike("name", name).maybeSingle();
  let scopeCompanyId = existing?.id as string | undefined;
  if (!scopeCompanyId) {
    const { data: ownerRow } = await db.from("users").select("name").eq("id", userId).maybeSingle();
    const { data: created, error } = await db
      .from("scope_companies")
      .insert({ name, owner: (ownerRow?.name as string | null) ?? null, notes: `Added from signal: ${noteTitle}` })
      .select("id")
      .single();
    if (error || !created) throw new Error(`Failed to add company to watchlist: ${error?.message ?? "unknown"}`);
    scopeCompanyId = created.id as string;
  }
  // Société HubSpot : lie l'existante (fuzzy) ou la crée si absente. Best-effort :
  // un échec HubSpot ne doit pas bloquer l'ajout watchlist.
  await ensureHubspotCompany(scopeCompanyId, name).catch((e) =>
    console.warn("[signals/act] HubSpot company ensure skipped:", e instanceof Error ? e.message : e),
  );
  return scopeCompanyId;
}

/**
 * Lie la scope_company à une société HubSpot : cache/fuzzy match d'abord
 * (resolveHubspotCompanyId persiste le lien), sinon CRÉE la société sur HubSpot
 * et mémorise son id. Best-effort.
 */
async function ensureHubspotCompany(scopeCompanyId: string, name: string): Promise<void> {
  const resolved = await resolveHubspotCompanyId(scopeCompanyId).catch(() => null);
  if (resolved?.hubspot_company_id) return; // déjà sur HubSpot
  const id = await createCompany(name).catch(() => null);
  if (id) {
    await db
      .from("scope_companies")
      .update({ hubspot_company_id: id, hubspot_resolved_at: new Date().toISOString() })
      .eq("id", scopeCompanyId);
  }
}

async function pushContactToHubspot(params: {
  hubspotCompanyId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
}): Promise<void> {
  try {
    const created = await hubspotFetch<{ id?: string }>("/crm/v3/objects/contacts", "POST", {
      properties: {
        email: params.email,
        firstname: params.firstName ?? "",
        lastname: params.lastName ?? "",
        jobtitle: params.title ?? "",
      },
    });
    if (created?.id && params.hubspotCompanyId) {
      await hubspotAssociate("contacts", created.id, "companies", params.hubspotCompanyId);
    }
  } catch (e) {
    console.warn("[signals/act] HubSpot contact push skipped:", e instanceof Error ? e.message : e);
  }
}
