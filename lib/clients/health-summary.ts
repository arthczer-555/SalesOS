import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import type { ClientEnrichmentContext } from "./context";
import type { Health } from "./types";

// Phrase d'explication du health score, ancrée surtout sur les derniers
// échanges. Le scoring (health.ts) ne regarde que la récence/volume des
// signaux ; ici on lit le CONTENU des meetings récents pour dire pourquoi le
// compte est vert/orange/rouge en une phrase. Best-effort : si ça échoue,
// l'enrichissement réussit quand même, on renvoie null.
//
// Haiku suffit (input court, sortie d'une phrase). FR pour rester cohérent
// avec le reste du panel health (labels + drivers déjà en français).

const HEALTH_SUMMARY_MODEL = "claude-haiku-4-5-20251001";

export async function generateHealthSummary(
  ctx: ClientEnrichmentContext,
  health: Health,
  userId: string | null = null,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

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
      return `- ${date} — ${m.meeting_title ?? "Meeting"} : ${recap}`;
    })
    .join("\n");

  const labelFr =
    health.label === "green" ? "vert (sain)" : health.label === "yellow" ? "orange (à surveiller)" : "rouge (à risque)";

  const prompt = `Tu analyses la santé d'un compte client Coachello (CS post-signature).

Score : ${health.score}/100 — ${labelFr}.
Facteurs calculés : ${health.drivers?.join(" ; ") || "(aucun)"}.

Derniers échanges (meetings récents) :
${recentMeetings || "(aucun meeting récent analysé)"}

Écris UNE seule phrase courte (max 35 mots), en français, qui explique pourquoi le compte est à ce niveau, en t'appuyant SURTOUT sur les derniers échanges (ton, sujets, signaux concrets). Pas de préambule, pas de guillemets, juste la phrase.`;

  const client = new Anthropic({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: HEALTH_SUMMARY_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    { label: "clients/health-summary" },
  );

  logUsage(userId, HEALTH_SUMMARY_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "clients_health_summary");

  const block = msg.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text.trim() : "";
  return text || null;
}
