import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { renderClientContextForPrompt, type ClientEnrichmentContext } from "./context";
import type { DealRecap } from "./types";

// Recap "comment ce deal a été signé" - style Coachello-GPT.
// Format structuré pour pouvoir réutiliser la timeline dans une fiche CS,
// dans un mail handover, ou dans un canal Slack. Stocké dans clients.deal_recap.

const DEAL_RECAP_SYSTEM_PROMPT = `Tu es analyste deal chez Coachello.

Tu reçois le contexte complet d'un deal closed-won : HubSpot (engagements,
contacts, company) + transcripts Claap des meetings sales.

Ton job : raconter en format structuré COMMENT ce deal a été signé, pour que
le CS qui prend la suite comprenne instantanément :
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
- N'invente rien. Si tu manques de contexte pour un field, mets null/[].`;

const DEAL_RECAP_TOOL: Anthropic.Tool = {
  name: "deal_recap",
  description: "Recap structuré de comment ce deal closed-won a été signé, à destination du CS.",
  input_schema: {
    type: "object",
    properties: {
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
    required: ["timeline", "how_closed", "objections", "triggers", "sales_promises", "onboarding_risks"],
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

export async function generateDealRecap(
  ctx: ClientEnrichmentContext,
  userId: string | null = null,
): Promise<DealRecap | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const prompt = renderClientContextForPrompt(ctx);

  const client = new Anthropic({ timeout: 600_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: DEAL_RECAP_MODEL,
        max_tokens: 4000,
        system: DEAL_RECAP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        tools: [DEAL_RECAP_TOOL],
        tool_choice: { type: "tool" as const, name: "deal_recap" },
      }),
    { label: "clients/deal-recap" },
  );

  logUsage(userId, DEAL_RECAP_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "clients_deal_recap");

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return null;
  const raw = block.input as RawRecap;

  return {
    generated_at: new Date().toISOString(),
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
