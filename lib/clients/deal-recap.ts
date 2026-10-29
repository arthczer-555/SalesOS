import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { renderClientContextForPrompt, type ClientEnrichmentContext } from "./context";
import { HUBSPOT_CHECKLIST_FIELDS, type DealRecap, type HubspotDealFields } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";
import { withForcedTool } from "../models/compat";

// Recap "comment ce deal a été signé" - style CoachelloAI.
// Format structuré pour pouvoir réutiliser la timeline dans une fiche CS,
// dans un mail handover, ou dans un canal Slack. Stocké dans clients.deal_recap.

const DEAL_RECAP_SYSTEM_PROMPT = `Tu es analyste deal chez Coachello.

Tu reçois le contexte complet d'un deal closed-won : HubSpot (engagements,
contacts, company) + transcripts Claap des meetings sales.

Ton job : raconter en format structuré COMMENT ce deal a été signé, pour que
le CS qui prend la suite comprenne instantanément :
  - le pain : ce qui a poussé l'entreprise à s'intéresser au coaching
  - le chemin du deal en 3-5 moments clés
  - ce qui a fait basculer le prospect
  - les objections rencontrées et comment elles ont été levées
  - les promesses faites par le sales (à respecter en onboarding)
  - les risques d'onboarding détectés

Règles :
- Tu réponds UNIQUEMENT via l'outil deal_recap.
- Style sobre, factuel. Pas de hype.
- Cite la source (claap recordingId ou hubspot engagement id) quand possible
  dans la timeline. Si tu n'as pas de source claire, mets source=null.
- Langue : adapte-toi à la langue dominante des transcripts (FR si majoritaire,
  EN sinon).
- N'invente rien. Si tu manques de contexte pour un field, mets null/[].
- Le pain est le problème de fond de l'entreprise, dit avec les mots du client
  quand c'est possible (ex: turnover des managers, promotions sans
  accompagnement, fusion, engagement en baisse, programme de leadership à
  passer à l'échelle). Ne le confonds pas avec les triggers (ce qui a fait
  signer maintenant) ni avec l'offre Coachello. Les discovery et premiers
  meetings sont la meilleure source ; la qualification HubSpot renseignée par
  l'AE (Need, Need detailed), si elle est fournie, est une déclaration à
  recouper avec les meetings, pas une vérité.
- ${NO_EM_DASH_RULE}`;

const DEAL_RECAP_TOOL: Anthropic.Tool = {
  name: "deal_recap",
  description: "Recap structuré de comment ce deal closed-won a été signé, à destination du CS.",
  input_schema: {
    type: "object",
    properties: {
      pain: {
        type: ["string", "null"],
        description:
          "Ce qui a poussé l'entreprise à s'intéresser au coaching (2-4 phrases courtes, 80 mots max) : le problème de fond, qui l'a exprimé, chiffré si le client l'a chiffré. null si le contexte ne le dit pas.",
      },
      timeline: {
        type: "array",
        items: {
          type: "object",
          properties: {
            when: { type: ["string", "null"], description: "Date ou période (ex: '15 mars 2026', 'fin février')" },
            title: { type: "string", description: "Titre court du moment (ex: 'Discovery initial', 'Démo produit')" },
            description: { type: "string", description: "1-2 phrases décrivant ce qui s'est passé" },
            source: {
              type: ["string", "null"],
              description: "claap:<recId> | hubspot:meeting:<id> | hubspot:email:<id> | hubspot:note:<id> | null",
            },
          },
          required: ["title", "description"],
        },
      },
      how_closed: { type: "string", description: "Comment le deal a basculé (3-5 phrases)" },
      objections: {
        type: "array",
        items: { type: "string" },
        description: "Objections rencontrées et comment elles ont été levées",
      },
      triggers: {
        type: "array",
        items: { type: "string" },
        description: "Leviers déclencheurs identifiés (urgence, sponsor interne, événement externe…)",
      },
      sales_promises: {
        type: "array",
        items: { type: "string" },
        description: "Engagements/promesses du sales pendant le deal (à respecter en onboarding)",
      },
      onboarding_risks: {
        type: "array",
        items: { type: "string" },
        description: "Risques d'onboarding détectés (champion fragile, scope flou, contraintes IT, etc.)",
      },
    },
    required: ["pain", "timeline", "how_closed", "objections", "triggers", "sales_promises", "onboarding_risks"],
  },
};

// Haiku 4.5 pendant la phase de test. Le recap demande de l'analyse narrative
// (timeline, levée d'objection) où Haiku peut être moins fin que Sonnet — à
// rebasculer si tu trouves le récit creux ou les sources mal citées.
const DEAL_RECAP_MODEL = "claude-haiku-4-5-20251001";

type RawTimelineItem = {
  when?: string | null;
  title: string;
  description: string;
  source?: string | null;
};

type RawRecap = {
  pain?: string | null;
  timeline?: RawTimelineItem[];
  how_closed?: string;
  objections?: string[];
  triggers?: string[];
  sales_promises?: string[];
  onboarding_risks?: string[];
};

function parseSourceField(s: string | null | undefined) {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  if (lower === "null" || lower === "none" || lower === "") return null;
  if (lower.startsWith("claap:")) {
    return { kind: "claap" as const, recordingId: s.slice("claap:".length).trim() || undefined };
  }
  if (lower.startsWith("hubspot:")) {
    const parts = s.slice("hubspot:".length).split(":");
    const entity = parts[0]?.trim().toLowerCase();
    const id = parts.slice(1).join(":").trim() || undefined;
    if (["note", "email", "meeting", "call", "deal", "company"].includes(entity)) {
      return { kind: "hubspot" as const, entity: entity as "note" | "email" | "meeting" | "call" | "deal" | "company", id };
    }
  }
  return { kind: "inferred" as const };
}

// Qualification "Need" saisie par l'AE dans HubSpot, ajoutée au contexte pour
// le pain (le snapshot du deal ne porte pas ces propriétés). Vide si HubSpot
// n'a rien ou n'a pas répondu.
function renderHubspotNeedForPrompt(hs: HubspotDealFields | null | undefined): string {
  if (!hs) return "";
  const needDef = HUBSPOT_CHECKLIST_FIELDS.find((f) => f.property === "need");
  const need = hs.need ? (needDef?.options?.find((o) => o.value === hs.need)?.label ?? hs.need) : null;
  const lines = [
    need ? `- Need : ${need}` : null,
    hs.needs ? `- Need detailed : ${hs.needs.slice(0, 1500)}` : null,
  ].filter(Boolean);
  return lines.length ? `\n## Qualification HubSpot (renseignée par l'AE)\n${lines.join("\n")}` : "";
}

export async function generateDealRecap(
  ctx: ClientEnrichmentContext,
  userId: string | null = null,
  hubspotFields: HubspotDealFields | null = null,
): Promise<DealRecap | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const model = await getModelPreference("clients", DEAL_RECAP_MODEL);
  const prompt = renderClientContextForPrompt(ctx) + renderHubspotNeedForPrompt(hubspotFields);

  const client = anthropicClient({ timeout: 600_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create(withForcedTool({
        model,
        max_tokens: 4000,
        system: DEAL_RECAP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        tools: [DEAL_RECAP_TOOL],
      }, "deal_recap")),
    { label: "clients/deal-recap" },
  );

  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_deal_recap");

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return null;
  const raw = block.input as RawRecap;

  return {
    generated_at: new Date().toISOString(),
    pain: raw.pain?.trim() || undefined,
    timeline: (raw.timeline ?? []).map((t) => ({
      when: t.when ?? undefined,
      title: t.title,
      description: t.description,
      source: parseSourceField(t.source),
    })),
    how_closed: raw.how_closed,
    objections: raw.objections ?? [],
    triggers: raw.triggers ?? [],
    sales_promises: raw.sales_promises ?? [],
    onboarding_risks: raw.onboarding_risks ?? [],
  };
}
