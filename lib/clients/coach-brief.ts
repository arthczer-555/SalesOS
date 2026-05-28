import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { renderClientContextForPrompt, type ClientEnrichmentContext } from "./context";
import type { CoachBrief } from "./types";

// Brief client à destination des coachs Coachello. C'est ce qu'on envoie sur
// le canal Slack des coachs au moment du staffing, suivant un template
// historique (voir le template dans les commits ou les anciens messages
// #coaches). Génération à partir du même contexte que l'extraction de
// fields, mais sortie en prose structurée (pas value/confidence/source) :
// le brief est consommé tel quel par des humains.
//
// Choix : on lance ce call EN PARALLÈLE de l'extraction des fields dans
// runClientEnrichment — même contexte d'input, donc on payerait deux fois
// les tokens d'entrée mais on gagne ~30s sur la latence totale.

const COACH_BRIEF_SYSTEM_PROMPT = `Tu es un Customer Success Manager chez Coachello (programmes de coaching pour
leaders / managers / dirigeants).

Tu reçois tout le contexte d'un deal venant d'être signé (closed-won) :
informations HubSpot (deal, contacts, company, notes, emails, meetings) +
transcripts des meetings Claap.

Ton job : rédiger le **brief client** qu'on partagera aux coachs sélectionnés
sur le canal Slack des coachs, pour qu'ils sachent qui ils vont accompagner.

Règles ABSOLUES :
- Tu RÉPONDS UNIQUEMENT via l'outil client_coach_brief. Pas de markdown libre.
- N'invente RIEN. Si une info n'est pas dans le contexte, laisse le field à
  null. Mieux vaut un brief partiel qu'un brief faux.
- Style : sobre, factuel, neutre. Pas de superlatifs. Pas de "exciting
  opportunity" / "amazing client" — un coach lit ça pour préparer, pas pour
  se motiver.
- Langue : adapte-toi à la langue dominante des transcripts. Si tout est en
  français, écris en français. Si c'est mixte, écris en anglais (lingua
  franca des coachs internationaux).
- Confidentialité : ne cite jamais un participant nommément dans la prose
  ouverte. Reste au niveau "le sponsor RH", "l'équipe leadership", etc.

Structure des champs (cf. tool input_schema) :
- intro : 1-2 phrases. Qui est la company, secteur, mission. Style "Adyen is
  a global fintech company founded in 2006 and headquartered in Amsterdam."
- industry : 1-3 mots (FinTech, RetailTech, Healthcare...).
- website : URL si tu la trouves dans le contexte, sinon null.
- context : 3-5 phrases. Taille de la boîte, géographie, culture, défis
  business / managériaux observés dans les discussions du deal.
- programs : 1-N programmes vendus. Pour chaque : nom (Executive Program /
  Managers Program / Leadership Program / etc.), description courte (1
  phrase), nb_sessions par coaché si connu, population ciblée.
- goal : 1 phrase sur l'objectif business / RH du coaching.
- location : "Global" / "Europe" / liste de pays.
- coaching_languages : par région (EUROPE / APAC / LATAM / Global), liste des
  langues. Inférable du domaine de la company + des participants.
- coachee_journey : 1-2 phrases décrivant le parcours du coaché côté
  Coachello (self-assessment, peer feedback, etc.). Si rien d'explicite,
  laisse null.
- ai_coaching : true / false / null. Coachello a une offre humaine ET une
  offre IA — déduire de la formule signée.
- coachello_app : "Slack" / "Teams" / "Email" / null si pas mentionné.
- briefing_meeting_date : ISO date (YYYY-MM-DD) ou null. C'est la réunion
  qu'on fait avec les coachs avant le démarrage du programme.
- nb_sessions_per_coachee : nombre, ou null si plusieurs programmes (auquel
  cas mets-le dans programs[].nb_sessions).
- tripartite : "Optional in first session" / "Required" / "None" / null.
- onboarding_start_date : ISO date ou null. Date de démarrage du programme
  (kickoff coachés).
- program_end_date : ISO date ou null.
- program_duration : texte court ("6 months", "9 months", "6 to 9 months").`;

const COACH_BRIEF_TOOL: Anthropic.Tool = {
  name: "client_coach_brief",
  description: "Génère le brief client à destination des coachs Coachello (partagé sur Slack au staffing).",
  input_schema: {
    type: "object",
    properties: {
      intro: { type: ["string", "null"] },
      industry: { type: ["string", "null"] },
      website: { type: ["string", "null"] },
      context: { type: ["string", "null"] },
      programs: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            nb_sessions: { type: ["number", "null"] },
            population: { type: ["string", "null"] },
          },
          required: ["name", "description"],
        },
      },
      goal: { type: ["string", "null"] },
      location: { type: ["string", "null"] },
      coaching_languages: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            region: { type: "string" },
            languages: { type: "array", items: { type: "string" } },
          },
          required: ["region", "languages"],
        },
      },
      coachee_journey: { type: ["string", "null"] },
      ai_coaching: { type: ["boolean", "null"] },
      coachello_app: { type: ["string", "null"] },
      briefing_meeting_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD ou null" },
      nb_sessions_per_coachee: { type: ["number", "null"] },
      tripartite: { type: ["string", "null"] },
      onboarding_start_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD ou null" },
      program_end_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD ou null" },
      program_duration: { type: ["string", "null"] },
    },
    required: ["intro", "industry", "context", "programs", "goal"],
  },
};

// Haiku 4.5 pendant la phase de test — basculer sur claude-sonnet-4-6 si la
// qualité du brief n'est pas suffisante sur les profils complexes.
const COACH_BRIEF_MODEL = "claude-haiku-4-5-20251001";

export async function generateCoachBrief(
  ctx: ClientEnrichmentContext,
  userId: string | null = null,
): Promise<CoachBrief | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const prompt = renderClientContextForPrompt(ctx);

  const client = new Anthropic({ timeout: 600_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: COACH_BRIEF_MODEL,
        max_tokens: 4000,
        system: COACH_BRIEF_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        tools: [COACH_BRIEF_TOOL],
        tool_choice: { type: "tool" as const, name: "client_coach_brief" },
      }),
    { label: "clients/coach-brief" },
  );

  logUsage(userId, COACH_BRIEF_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "clients_coach_brief");

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return null;

  // Cast direct : le tool_choice force la forme et on tolère les nulls partout.
  return block.input as CoachBrief;
}
