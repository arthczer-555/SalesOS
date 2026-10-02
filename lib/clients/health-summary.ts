import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import type { ClientEnrichmentContext } from "./context";
import { meetingLink } from "./health";
import type { Health, HealthTone } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";
import { noExtendedThinking, withForcedTool } from "../models/compat";

// Phrase d'explication du health score, ancrée surtout sur les derniers
// échanges. Le scoring (health.ts) ne regarde que la récence/volume des
// signaux ; ici on lit le CONTENU des meetings récents pour dire pourquoi le
// compte est vert/orange/rouge en une phrase. Best-effort : si ça échoue,
// l'enrichissement réussit quand même, on renvoie null.
//
// Haiku suffit (input court, sortie d'une phrase).
//
// Ce fichier porte aussi le juge de ton (judgeRecentTone), qui lui ENTRE dans
// le score : il tourne avant computeHealth, le résumé après.

const HEALTH_SUMMARY_MODEL = "claude-haiku-4-5-20251001";

export async function generateHealthSummary(
  ctx: ClientEnrichmentContext,
  health: Health,
  userId: string | null = null,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const model = await getModelPreference("clients", HEALTH_SUMMARY_MODEL);

  const recentMeetings = [...(ctx.meetings ?? [])]
    .filter((m) => m.meeting_started_at)
    .sort(
      (a, b) =>
        new Date(b.meeting_started_at as string).getTime() -
        new Date(a.meeting_started_at as string).getTime(),
    )
    .slice(0, 3)
    .map((m) => {
      const date = m.meeting_started_at?.slice(0, 10) ?? "?";
      const recap = m.meeting_recap_summary?.slice(0, 600) ?? "(pas de recap)";
      return `- ${date} - ${m.meeting_title ?? "Meeting"} : ${recap}`;
    })
    .join("\n");

  const labelFr =
    health.label === "green" ? "vert (sain)" : health.label === "yellow" ? "orange (à surveiller)" : "rouge (à risque)";

  const prompt = `Tu analyses la santé d'un compte client Coachello (CS post-signature).

Score : ${health.score}/100 - ${labelFr}.
Facteurs calculés : ${health.drivers?.join(" ; ") || "(aucun)"}.

Derniers échanges (meetings récents) :
${recentMeetings || "(aucun meeting récent analysé)"}

Écris UNE seule phrase courte (max 35 mots), dans la langue dominante des derniers échanges (anglais par défaut si mixte ou incertain), qui explique pourquoi le compte est à ce niveau, en t'appuyant SURTOUT sur les derniers échanges (ton, sujets, signaux concrets). Pas de préambule, pas de guillemets, juste la phrase.

${NO_EM_DASH_RULE}`;

  const client = anthropicClient({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
        ...noExtendedThinking(model),
      }),
    { label: "clients/health-summary" },
  );

  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_health_summary");

  const block = msg.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text.trim() : "";
  return text ? stripEmDashes(text) : null;
}

// ── Ton des derniers meetings (signal 5 du health) ─────────────────────────
// Lit les 3 derniers meetings Claap des 90 derniers jours (recap, sinon extrait
// de transcript) et classe le ton du client : positive / neutral / negative,
// avec une phrase de justification affichée dans le popup du score.
// null = aucun meeting récent à lire (pas une erreur). Throw = échec : l'appelant
// passe toneError, le signal n'est pas noté et la carte le signale.

const TONE_DAYS = 90;
const TONE_MAX_MEETINGS = 3;

const TONE_TOOL = {
  name: "meeting_tone",
  description: "Classe le ton du client dans les derniers meetings.",
  input_schema: {
    type: "object" as const,
    properties: {
      label: {
        type: "string",
        enum: ["positive", "neutral", "negative"],
        description:
          "positive : client satisfait, engagé, projette la suite. negative : insatisfaction, frustration, doute sur la valeur, gel ou baisse de budget, sponsor qui part, menace de ne pas renouveler. neutral : opérationnel sans signal net, ou signaux mixtes.",
      },
      reason: {
        type: "string",
        description:
          "UNE phrase en anglais (max 30 mots) qui cite le signal concret le plus parlant (ce que le client a dit ou fait). Pas de guillemets.",
      },
    },
    required: ["label", "reason"],
  },
};

export async function judgeRecentTone(
  ctx: ClientEnrichmentContext,
  userId: string | null = null,
): Promise<HealthTone | null> {
  const now = Date.now();
  const recent = (ctx.meetings ?? [])
    .map((m) => ({ m, t: m.meeting_started_at ? new Date(m.meeting_started_at).getTime() : NaN }))
    .filter((r) => Number.isFinite(r.t) && r.t <= now && now - r.t <= TONE_DAYS * 86_400_000)
    .filter((r) => r.m.meeting_recap_summary || r.m.transcript_text)
    .sort((a, b) => b.t - a.t)
    .slice(0, TONE_MAX_MEETINGS)
    .map((r) => r.m);
  if (recent.length === 0) return null;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const model = await getModelPreference("clients", HEALTH_SUMMARY_MODEL);
  const block = recent
    .map((m) => {
      const date = m.meeting_started_at?.slice(0, 10) ?? "?";
      const body = m.meeting_recap_summary
        ? m.meeting_recap_summary.slice(0, 1500)
        : `(extrait de transcript) ${m.transcript_text?.slice(-4000) ?? ""}`;
      return `### ${date} - ${m.meeting_title ?? "Meeting"}\n${body}`;
    })
    .join("\n\n");

  const prompt = `Tu évalues le ton d'un client Coachello (programme de coaching déjà signé) dans ses derniers meetings avec nous. Juge le CLIENT, pas l'équipe Coachello. Le plus récent compte le plus.

${block}

${NO_EM_DASH_RULE}`;

  const client = anthropicClient({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create(withForcedTool({
        model,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
        tools: [TONE_TOOL],
      }, TONE_TOOL.name)),
    { label: "clients/health-tone" },
  );
  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_health_tone");

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  const input = toolBlock && "input" in toolBlock ? (toolBlock.input as { label?: unknown; reason?: unknown }) : null;
  const label = input?.label;
  if (label !== "positive" && label !== "neutral" && label !== "negative") {
    throw new Error("Tone judge returned no usable label");
  }
  return {
    label,
    reason: stripEmDashes(typeof input?.reason === "string" ? input.reason.trim() : ""),
    meetings: recent.map((m) => ({
      recording_id: m.recording_id,
      title: m.meeting_title,
      date: m.meeting_started_at,
      url: meetingLink(m),
    })),
  };
}
