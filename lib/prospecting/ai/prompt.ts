// Construction des prompts d'écriture Prospecting. Module PUR (aucun accès
// réseau ni DB) : testable via scripts/test-prospecting-prompt.ts.
//
// Le system prompt est découpé en 3 blocs du plus stable au plus volatil, chacun
// marqué cache_control : sur un batch de génération, seul le message utilisateur
// (le prospect) change, donc tout le reste est lu depuis le cache Anthropic.
//   1. règles globales (rôle, règle d'or, tirets, best practices, formats)
//   2. connaissance Coachello + roster clients + persona
//   3. guide de style + campagne + spec de la séquence
//
// Tout texte injecté passe par stripEmDashes : les modèles imitent ce qu'ils
// lisent, et Notion / le guide maison contiennent des tirets longs.
import type Anthropic from "@anthropic-ai/sdk";
import { stripEmDashes } from "@/lib/no-em-dash";
import { BEST_PRACTICES_PROMPT } from "../best-practices";
import { stepDayOffsets } from "../settings";
import { ANGLES, STEP_KIND_META } from "../templates";
import type {
  CampaignLanguage,
  ContactResearch,
  ContactRow,
  Persona,
  StepConfig,
  StepKind,
  StepLength,
  ThreadMode,
} from "../types";
import type { KnowledgePageRef } from "./types";

// Règle tirets SANS le caractère lui-même (sinon le prompt en contiendrait).
export const DASH_RULE =
  "RÈGLE ABSOLUE, AUCUNE EXCEPTION : n'utilise JAMAIS de tiret long (em dash, caractère Unicode U+2014) ni de tiret moyen (en dash, U+2013), nulle part (sujets, corps, notes LinkedIn, scripts d'appel). Remplace-les par une virgule, un point, deux-points, des parenthèses ou un tiret court (-).";

export const LINKEDIN_INVITE_MAX = 200;
export const LINKEDIN_MESSAGE_MAX = 400;
const KNOWLEDGE_PROMPT_MAX = 45_000;
const GUIDE_PROMPT_MAX = 8_000;

/** Nettoie un texte injecté dans un prompt (tirets longs/moyens, espaces). */
export function clean(text: string | null | undefined): string {
  return stripEmDashes(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Entrées ─────────────────────────────────────────────────────────────────

export interface PromptKnowledge {
  text: string;
  source: "notion" | "fallback";
  pages: KnowledgePageRef[];
}

export interface PromptCampaign {
  name: string;
  goal: string;
  instructions: string;
  language: CampaignLanguage;
  softOptOut: boolean;
}

export interface PromptStep {
  position: number;
  kind: StepKind;
  threadMode: ThreadMode;
  delayDays: number;
  config: StepConfig;
}

export interface SequencePromptInput {
  persona: Persona | null;
  knowledge: PromptKnowledge;
  houseStyle: string;
  campaign: PromptCampaign;
  steps: PromptStep[];
  roster: string;
  senderName: string;
}

// ── Bloc 1 : règles globales ────────────────────────────────────────────────

export const GLOBAL_RULES = `Tu es un SDR senior chez Coachello. Tu écris des séquences de prospection B2B multicanal (emails, LinkedIn, appels) pour un commercial de l'équipe, prospect par prospect, à partir d'une recherche réelle.

## RÈGLE D'OR : zéro invention
- Tu ne peux citer QUE : (1) les PREUVES AUTORISÉES et les INSIGHTS du persona, avec leurs chiffres exacts ; (2) les clients du ROSTER (nom et secteur, sans leur attribuer de résultat chiffré, sauf si ce résultat figure dans une preuve autorisée) ; (3) les FAITS DE RECHERCHE fournis sur le prospect et son entreprise.
- Un client du roster se cite comme une simple référence ("des équipes comme X travaillent avec nous") : ne décris jamais ce qu'il fait avec Coachello, quelles équipes l'utilisent ni ses résultats, sauf si une preuve autorisée le dit.
- N'attribue jamais un chiffre à un concurrent de Coachello (liste des concurrents du persona) : présente-le comme un benchmark de marché, sans nommer la source.
- La connaissance Coachello (pages Notion) sert à comprendre l'offre et le positionnement. Un chiffre, un résultat ou un nom de client qui n'apparaît que là, sans être dans les preuves autorisées ou le roster, ne doit PAS être cité.
- Aucun chiffre, pourcentage, nom de client, citation, événement ou fait sur le prospect qui ne vienne pas de ces sources. Dans le doute, retire-le.
- Ne prétends jamais avoir lu, vu ou entendu quelque chose qui n'est pas dans la recherche. N'invente aucune relation ni conversation passée.
- Respecte la liste "à ne pas mentionner" du brief de recherche.
- Les douleurs du persona sont des HYPOTHÈSES : formule-les comme des constats généraux ou des questions ("beaucoup de managers sales..."), jamais comme une affirmation sur le prospect.
- N'écris jamais de placeholder ou de variable ({{firstName}}, [Prénom], [Company]...) : écris les vraies valeurs ou reformule.

${DASH_RULE}

${BEST_PRACTICES_PROMPT}

## Format par type d'étape
- Email, nouveau thread : un sujet (2 à 5 mots, minuscules naturelles, honnête) et un corps en texte brut. Pas de markdown, pas de puces, pas de gras. Pas de lien dans le premier email. Salutation avec le prénom du prospect. Termine par le prénom de l'expéditeur seul sur la dernière ligne : la signature email complète est ajoutée automatiquement, ne l'écris pas.
- Email en réponse dans le thread : PAS de sujet (subject vide). Le message se lit comme la suite naturelle du précédent, sans le résumer ni le répéter. Prénom de l'expéditeur seul sur la dernière ligne.
- Invitation LinkedIn : note de connexion de ${LINKEDIN_INVITE_MAX} caractères MAXIMUM espaces compris (compte-les), sans pitch, sans lien, sans signature. Subject vide.
- Message LinkedIn : ${LINKEDIN_MESSAGE_MAX} caractères MAXIMUM, ton de message privé, une idée et une question légère, pas de formule de politesse lourde. Subject vide.
- Appel : le body contient deux parties, exactement sous cette forme : une ligne "Talk track:" suivie de l'accroche (20 secondes), une ou deux questions de découverte et la demande de rendez-vous ; puis une ligne vide ; puis une ligne qui commence exactement par "Voicemail:" suivie du message vocal (20 secondes maximum), sans gras ni markdown. Garde ces deux intitulés en anglais tels quels. Subject vide.
- Tâche manuelle : body = consigne courte et concrète pour le commercial (quoi faire et, si besoin, le texte à utiliser). Subject vide.
- Visite de profil LinkedIn : aucun contenu, ne la renvoie pas.

## Cohérence de la séquence
- Écris les étapes demandées comme un tout cohérent : chaque étape utilise l'angle indiqué et apporte quelque chose de nouveau (pas deux fois la même accroche, le même chiffre ou la même preuve).
- Les relances ne disent jamais "je me permets de relancer", "just checking in", "following up", "petite relance".
- Les touches LinkedIn et l'appel peuvent faire référence aux emails ("je vous ai écrit au sujet de...") sans les recopier.
- Si une étape a des consignes précises, elles priment sur l'angle par défaut (jamais sur la règle d'or).
- Si l'angle demandé exige une preuve (cas client, chiffre, social proof) et qu'aucune preuve autorisée ne convient, rabats-toi sur un angle problème ou insight plutôt que d'inventer.
- hookUsed : en quelques mots, le fait de recherche sur lequel l'étape s'appuie (vide si aucun).

## Langue
Écris TOUT le contenu (sujets, corps, notes, scripts) dans la langue imposée par le message utilisateur. Les consignes sont en français, mais la langue des messages est celle du prospect. En français : vouvoiement, sauf consigne contraire de la campagne.

Réponds uniquement via l'outil fourni.`;

// ── Bloc 2 : connaissance + roster + persona ────────────────────────────────

function bullet(items: string[]): string {
  return items.map((s) => `- ${clean(s)}`).join("\n");
}

export function renderPersona(persona: Persona | null): string {
  if (!persona) {
    return "## Persona ciblé\nAucun persona défini pour cette campagne : reste sur l'offre générale Coachello, sans chiffre.";
  }
  const m = persona.messaging;
  const lines: string[] = [`## Persona ciblé : ${clean(persona.name)}`];
  if (persona.description) lines.push(clean(persona.description));
  if (m.pains.length) lines.push("", "Douleurs typiques (hypothèses, à formuler comme telles) :", bullet(m.pains));
  if (m.valueProps.length) lines.push("", "Ce que Coachello apporte à ce persona :", bullet(m.valueProps));
  lines.push("", "PREUVES AUTORISÉES (les seuls chiffres et résultats clients citables) :");
  lines.push(
    m.proofPoints.length
      ? m.proofPoints.map((p) => `- ${clean(p.text)}${p.source ? ` (source : ${clean(p.source)})` : ""}`).join("\n")
      : "- Aucune preuve validée pour l'instant : n'écris AUCUN chiffre ni résultat client.",
  );
  if (m.insights.length) {
    // Une étude publiée par un concurrent ne se cite pas dans un cold email.
    const competitors = m.competitors.map((c) => c.trim().toLowerCase()).filter(Boolean);
    const fromCompetitor = (src: string | null | undefined) => !!src && competitors.some((c) => src.toLowerCase().includes(c));
    lines.push(
      "",
      "INSIGHTS MARCHÉ (chiffres tiers citables tels quels ; tu peux nommer leur source, sauf mention contraire) :",
      m.insights
        .map((p) => `- ${clean(p.text)}${p.source ? (fromCompetitor(p.source) ? " (benchmark de marché : NE NOMME PAS la source, c'est un concurrent)" : ` (source : ${clean(p.source)})`) : ""}`)
        .join("\n"),
    );
  }
  if (m.objections.length) {
    lines.push(
      "",
      "Objections fréquentes (à anticiper en douceur, sans les citer mot pour mot) :",
      m.objections.map((o) => `- "${clean(o.objection)}" : ${clean(o.answer)}`).join("\n"),
    );
  }
  if (m.competitors.length) {
    lines.push(
      "",
      `Concurrents : ${m.competitors.map(clean).join(", ")}. Ne les dénigre jamais ; ne les mentionne que si la recherche montre qu'ils sont en place chez le prospect.`,
    );
  }
  if (m.ctas.length) lines.push("", "CTA qui fonctionnent pour ce persona (à adapter) :", bullet(m.ctas));
  if (m.tone) lines.push("", `Ton : ${clean(m.tone)}`);
  if (m.examples.length) {
    lines.push("", "Exemples validés par l'équipe (style à imiter, ne pas copier) :");
    m.examples.slice(0, 4).forEach((e, i) => lines.push(`<exemple ${i + 1}>\n${clean(e)}\n</exemple ${i + 1}>`));
  }
  return lines.join("\n");
}

export function renderKnowledge(k: PromptKnowledge): string {
  const header =
    k.source === "notion"
      ? "## Connaissance Coachello (pages Notion synchronisées, source de vérité sur l'offre)"
      : "## Connaissance Coachello (repli : la base Notion n'est pas synchronisée)";
  let text = clean(k.text);
  if (text.length > KNOWLEDGE_PROMPT_MAX) text = `${text.slice(0, KNOWLEDGE_PROMPT_MAX)}\n[...tronqué]`;
  return `${header}\n${text}`;
}

export function renderRoster(roster: string): string {
  return `## Roster clients Coachello (seule social proof autorisée en plus des preuves du persona ; nom et secteur uniquement)\n${clean(roster) || "Aucun client de référence disponible : pas de social proof."}`;
}

// ── Bloc 3 : style + campagne + séquence ────────────────────────────────────

const LENGTH_HINT: Record<StepLength, { first: string; followup: string }> = {
  short: { first: "50 à 90 mots", followup: "30 à 60 mots" },
  standard: { first: "80 à 120 mots", followup: "50 à 90 mots" },
  long: { first: "110 à 150 mots", followup: "80 à 110 mots" },
};

/** Position de l'email qui ouvre le thread auquel répond l'étape `index` (null = nouveau thread). */
export function threadRootPosition(steps: PromptStep[], index: number): number | null {
  const s = steps[index];
  if (s.kind !== "email" || s.threadMode !== "reply") return null;
  for (let i = index - 1; i >= 0; i--) {
    const p = steps[i];
    if (p.kind === "email" && p.threadMode === "new") return p.position;
  }
  for (let i = index - 1; i >= 0; i--) if (steps[i].kind === "email") return steps[i].position;
  return null;
}

export function firstEmailPosition(steps: { kind: StepKind; position: number }[]): number | null {
  return steps.find((s) => s.kind === "email")?.position ?? null;
}

function kindLabel(step: PromptStep, steps: PromptStep[], index: number): string {
  if (step.kind === "email") {
    const root = threadRootPosition(steps, index);
    return root ? `Email en réponse dans le thread de l'étape ${root} (pas de sujet)` : "Email, nouveau thread (avec sujet)";
  }
  const map: Record<Exclude<StepKind, "email">, string> = {
    linkedin_visit: "Visite de profil LinkedIn (aucun contenu)",
    linkedin_invite: `Invitation LinkedIn (note de ${LINKEDIN_INVITE_MAX} caractères max)`,
    linkedin_message: `Message LinkedIn (${LINKEDIN_MESSAGE_MAX} caractères max)`,
    call: "Appel (talk track + voicemail)",
    task: "Tâche manuelle",
  };
  return map[step.kind];
}

export function renderStepSpec(step: PromptStep, steps: PromptStep[], index: number, dayOffset: number): string {
  const c = step.config;
  const parts = [`Étape ${step.position} · Jour ${dayOffset} · ${kindLabel(step, steps, index)}`];
  if (step.kind === "linkedin_visit") return parts.join(" · ");
  if (c.mode === "template") {
    const tpl = [c.template.subject ? `sujet "${clean(c.template.subject)}"` : "", `corps :\n${clean(c.template.body)}`].filter(Boolean).join(", ");
    return `${parts.join(" · ")} · Texte fixe (template, ne pas l'écrire, pour contexte uniquement) : ${tpl}`;
  }
  const angle = ANGLES[c.angle];
  parts.push(`Angle : ${angle.label} (${angle.hint})`);
  if (step.kind === "email") {
    const isFirst = firstEmailPosition(steps) === step.position;
    parts.push(`Longueur : ${isFirst ? LENGTH_HINT[c.length].first : LENGTH_HINT[c.length].followup}`);
  }
  if (c.cta.trim()) parts.push(`CTA souhaité : ${clean(c.cta)}`);
  if (c.instructions.trim()) parts.push(`Consignes : ${clean(c.instructions)}`);
  return parts.join(" · ");
}

export function renderSequence(steps: PromptStep[]): string {
  const offsets = stepDayOffsets(steps);
  return [
    "## Séquence complète (dans l'ordre ; les jours sont des jours d'envoi après l'inscription)",
    ...steps.map((s, i) => renderStepSpec(s, steps, i, offsets[i] ?? 0)),
  ].join("\n");
}

export function renderCampaign(c: PromptCampaign, senderName: string): string {
  const first = senderName.trim().split(/\s+/)[0] || senderName;
  const lines = [
    `## Campagne "${clean(c.name)}"`,
    `Objectif : ${clean(c.goal) || "obtenir un premier échange de découverte de 15 à 20 minutes"}`,
  ];
  if (c.instructions.trim()) lines.push(`Consignes de la campagne (prioritaires sur le guide de style, jamais sur la règle d'or) :\n${clean(c.instructions)}`);
  lines.push(
    c.language === "auto"
      ? "Langue : celle du prospect (indiquée dans le message utilisateur)."
      : `Langue imposée par la campagne : ${c.language === "fr" ? "français" : "anglais"}.`,
  );
  if (c.softOptOut) {
    lines.push(
      "Opt-out doux : termine le PREMIER email (et lui seul) par une phrase courte et naturelle qui laisse dire non, par exemple \"If this isn't on your radar, just tell me and I won't follow up.\" ou \"Si ce n'est pas un sujet pour vous, dites-le moi et je n'insisterai pas.\"",
    );
  }
  lines.push(`Expéditeur : ${clean(senderName)} (Coachello). Signe avec son prénom : ${clean(first)}.`);
  return lines.join("\n");
}

export function renderHouseStyle(guide: string): string {
  let g = clean(guide);
  if (!g) return "";
  if (g.length > GUIDE_PROMPT_MAX) g = `${g.slice(0, GUIDE_PROMPT_MAX)}\n[...tronqué]`;
  return `## Guide de style maison (ton, structure, exemples)
Ce guide sert au TON et à la STRUCTURE. Les chiffres, noms de clients et résultats qu'il contient ne sont PAS des preuves autorisées, sauf s'ils figurent aussi dans les preuves du persona. Ignore ses placeholders entre crochets. Si une règle de longueur du guide contredit les longueurs de la séquence, suis la séquence.
<guide>
${g}
</guide>`;
}

// ── Assemblage ──────────────────────────────────────────────────────────────

const EPHEMERAL = { type: "ephemeral" as const };

/** Blocs système partagés par l'écriture de séquence, la régénération d'étape et l'email ponctuel. */
export function buildBaseBlocks(input: { persona: Persona | null; knowledge: PromptKnowledge; roster: string }): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: GLOBAL_RULES, cache_control: EPHEMERAL },
    {
      type: "text",
      text: [renderKnowledge(input.knowledge), renderRoster(input.roster), renderPersona(input.persona)].join("\n\n"),
      cache_control: EPHEMERAL,
    },
  ];
}

export function buildSequenceSystem(input: SequencePromptInput): Anthropic.TextBlockParam[] {
  const campaignBlock = [renderHouseStyle(input.houseStyle), renderCampaign(input.campaign, input.senderName), renderSequence(input.steps)]
    .filter(Boolean)
    .join("\n\n");
  return [...buildBaseBlocks(input), { type: "text", text: campaignBlock, cache_control: EPHEMERAL }];
}

// ── Message utilisateur : le prospect ───────────────────────────────────────

export type ProspectFields = Pick<
  ContactRow,
  "first_name" | "last_name" | "title" | "company_name" | "company_domain" | "country" | "location" | "industry" | "company_size" | "linkedin_url"
>;

export function renderProspect(c: ProspectFields): string {
  const rows: [string, string | null][] = [
    ["Nom", `${c.first_name} ${c.last_name}`.trim()],
    ["Poste", c.title],
    ["Entreprise", c.company_name],
    ["Domaine", c.company_domain],
    ["Secteur", c.industry],
    ["Taille", c.company_size],
    ["Localisation", [c.location, c.country].filter(Boolean).join(", ") || null],
    ["LinkedIn", c.linkedin_url],
  ];
  return ["## Prospect", ...rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k} : ${clean(v)}`)].join("\n");
}

export function renderResearch(r: ContactResearch | null): string {
  if (!r) return "## Recherche\nAucune recherche disponible : reste générique sur l'entreprise, n'invente aucun fait.";
  const out: string[] = [];
  const b = r.brief;
  if (b) {
    out.push("## Brief de recherche");
    if (b.summary) out.push(clean(b.summary));
    if (b.hooks.length) {
      out.push("Accroches possibles (de la plus forte à la plus faible) :");
      for (const h of [...b.hooks].sort((x, y) => y.strength - x.strength)) {
        const meta = [h.kind, h.date ? `daté ${h.date}` : null, `force ${h.strength}/3`, h.sourceUrl ? `source ${h.sourceUrl}` : null].filter(Boolean).join(", ");
        out.push(`- ${clean(h.text)} (${meta})`);
      }
    }
    if (b.pains.length) out.push("Douleurs probables pour ce prospect :", bullet(b.pains));
    out.push(`Fit persona : ${b.personaFit.score}/100 (${clean(b.personaFit.reason)})`);
    if (b.suggestedAngle) out.push(`Angle suggéré : ${clean(b.suggestedAngle)}`);
    if (b.doNotMention.length) out.push("À NE PAS mentionner :", bullet(b.doNotMention));
  }
  const f = r.facts;
  const facts: [string, string | undefined][] = [
    ["Profil LinkedIn", f.linkedin],
    ["Posts LinkedIn récents", f.posts],
    ["Entreprise", f.company],
    ["Actualités", f.news],
    ["Recrutements", f.hiring],
    ["Historique CRM (HubSpot)", f.hubspot],
    ["Emails déjà envoyés par l'équipe", f.outreach],
  ];
  const present = facts.filter(([, v]) => v && v.trim());
  if (present.length) {
    out.push("", "## Faits de recherche (seuls faits citables sur le prospect et son entreprise)");
    for (const [label, v] of present) out.push(`### ${label}\n${clean(v)}`);
  }
  if (r.errors.length) out.push("", `Sources indisponibles (ne rien supposer à leur sujet) : ${r.errors.map(clean).join(" ; ")}`);
  return out.join("\n");
}

export interface ExistingStepContent {
  position: number;
  kind: StepKind;
  subject: string | null;
  body: string | null;
  note: string;
}

export function renderExisting(existing: ExistingStepContent[]): string {
  if (!existing.length) return "";
  return [
    "## Étapes déjà écrites (à conserver telles quelles ; sers-t'en pour rester cohérent et ne pas te répéter)",
    ...existing.map(
      (e) =>
        `<etape ${e.position} ${STEP_KIND_META[e.kind].label} (${e.note})>\n${e.subject ? `Sujet : ${clean(e.subject)}\n` : ""}${clean(e.body) || "(pas de contenu)"}\n</etape ${e.position}>`,
    ),
  ].join("\n");
}

export function languageName(lang: "en" | "fr"): string {
  return lang === "fr" ? "français" : "anglais";
}

export function buildProspectMessage(input: {
  contact: ProspectFields;
  research: ContactResearch | null;
  language: "en" | "fr";
  targets: number[];
  existing: ExistingStepContent[];
}): string {
  return [
    renderProspect(input.contact),
    renderResearch(input.research),
    renderExisting(input.existing),
    `## À faire
Écris les étapes ${input.targets.join(", ")} de la séquence pour ce prospect, en une seule réponse cohérente.
Langue imposée : ${languageName(input.language)}.
Renvoie exactement une entrée par étape demandée (position = numéro d'étape), via l'outil write_sequence.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Schéma de l'outil d'écriture ────────────────────────────────────────────

export const WRITE_SEQUENCE_TOOL: Anthropic.Tool = {
  name: "write_sequence",
  description: "Retourne le contenu des étapes demandées de la séquence de prospection pour ce prospect.",
  input_schema: {
    type: "object",
    properties: {
      language: { type: "string", enum: ["en", "fr"], description: "Langue utilisée pour tous les messages." },
      personalizationNote: {
        type: "string",
        description: "Une phrase (en anglais) qui résume la personnalisation pour le commercial, ex. 'Opens on their 3 open AE roles, numbers angle on ramp time.'",
      },
      steps: {
        type: "array",
        description: "Une entrée par étape demandée.",
        items: {
          type: "object",
          properties: {
            position: { type: "integer", description: "Numéro de l'étape." },
            subject: { type: "string", description: "Sujet pour un email en nouveau thread, sinon chaîne vide." },
            body: { type: "string", description: "Contenu en texte brut (email, note LinkedIn, script d'appel, consigne de tâche)." },
            angle: { type: "string", description: "Angle réellement utilisé (problem, timeline, numbers, social_proof, insight, trigger, referral, breakup, custom)." },
            hookUsed: { type: "string", description: "Fait de recherche utilisé, en quelques mots, ou chaîne vide." },
          },
          required: ["position", "subject", "body", "angle", "hookUsed"],
        },
      },
    },
    required: ["language", "personalizationNote", "steps"],
  },
};

/** Langue d'écriture : forcée par la campagne, sinon celle du brief, sinon heuristique pays/domaine. */
export function resolveLanguage(
  campaignLanguage: CampaignLanguage,
  research: ContactResearch | null,
  contact: Pick<ContactRow, "country" | "location" | "company_domain" | "email">,
): "en" | "fr" {
  if (campaignLanguage === "en" || campaignLanguage === "fr") return campaignLanguage;
  if (research?.brief?.language) return research.brief.language;
  const geo = `${contact.country ?? ""} ${contact.location ?? ""}`.toLowerCase();
  if (/\b(france|fr|paris|lyon|marseille|toulouse|bordeaux|lille|nantes|belgique|québec|quebec)\b/.test(geo)) return "fr";
  const domain = (contact.company_domain ?? contact.email?.split("@")[1] ?? "").toLowerCase();
  if (domain.endsWith(".fr")) return "fr";
  return "en";
}
