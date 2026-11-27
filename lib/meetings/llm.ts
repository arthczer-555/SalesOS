// Appel Claude à sortie structurée pour le flux #1y-new-meetings.
//
// Sortie via output_config.format (json_schema), comme lib/agents/design.ts :
// jamais de tool_choice forcé (refusé par Sonnet 5.5 / Opus 5.5, cf.
// lib/models/compat.ts). Modèle choisi dans l'admin (clé "meetings").

import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { noExtendedThinking } from "@/lib/models/compat";

export const MEETINGS_MODEL_KEY = "meetings";
export const DEFAULT_MEETINGS_MODEL = "claude-sonnet-5-5";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

export async function callStructured<T>(opts: {
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  label: string;
  maxTokens?: number;
}): Promise<T> {
  const model = await getModelPreference(MEETINGS_MODEL_KEY, DEFAULT_MEETINGS_MODEL);
  const client = anthropicClient({ timeout: 90_000, creditContext: "New meetings (#1y-new-meetings)" });
  const maxTokens = opts.maxTokens ?? 4000;
  const textOf = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");

  const run = async (): Promise<{ value: T; usage: Anthropic.Usage }> => {
    try {
      const message = await client.messages
        .stream({
          model,
          max_tokens: maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.content }],
          output_config: { format: { type: "json_schema", schema: opts.schema } },
          ...noExtendedThinking(model),
        })
        .finalMessage();
      return { value: JSON.parse(textOf(message)) as T, usage: message.usage };
    } catch (e) {
      // Modèle qui ne gère pas les structured outputs : on redemande en texte.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.warn(`[meetings/${opts.label}] structured output rejected, falling back to text JSON:`, e.message);
      const message = await client.messages
        .stream({
          model,
          max_tokens: maxTokens,
          system: `${opts.system}\n\nAnswer ONLY with a valid JSON object matching this schema, in a \`\`\`json block:\n${JSON.stringify(opts.schema)}`,
          messages: [{ role: "user", content: opts.content }],
          ...noExtendedThinking(model),
        })
        .finalMessage();
      return { value: extractJson(textOf(message)) as T, usage: message.usage };
    }
  };

  const { value, usage } = await withAnthropicRetry(run, { label: `meetings/${opts.label}`, maxAttempts: 3 });
  logUsage(null, model, usage.input_tokens, usage.output_tokens, `meetings_${opts.label}`);
  return value;
}
