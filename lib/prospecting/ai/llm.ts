// Appel Claude à sortie structurée (outil "forcé") partagé par toute la tranche
// IA de Prospecting : client Anthropic maison, retry 429/5xx, compat des modèles
// qui refusent le tool_choice forcé (Sonnet 5.5), log d'usage en équivalent-coût
// (le prompt caching rend input_tokens trompeur sinon).
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { logUsage } from "@/lib/log-usage";
import { withForcedTool } from "@/lib/models/compat";

export const WRITE_MODEL_DEFAULT = "claude-sonnet-5-5";
export const FAST_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

export interface ToolCallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ToolCallResult<T> {
  input: T;
  model: string;
  usage: ToolCallUsage;
  stopReason: string | null;
}

export class ToolCallError extends Error {}

export async function callTool<T>(opts: {
  model: string;
  system: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tool: Anthropic.Tool;
  maxTokens: number;
  label: string;
  userId: string | null;
  feature: string;
  timeoutMs?: number;
}): Promise<ToolCallResult<T>> {
  const client = anthropicClient({ timeout: opts.timeoutMs ?? 90_000, maxRetries: 0, creditContext: opts.label });
  const params = withForcedTool(
    {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: opts.messages,
      tools: [opts.tool],
    },
    opts.tool.name,
  );
  const message = await withAnthropicRetry(() => client.messages.create(params), { label: opts.label, maxAttempts: 3 });

  const usage: ToolCallUsage = {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
  };
  // usage_logs n'a que input/output : input "équivalent-coût" (frais x1 +
  // écriture cache x1.25 + lecture cache x0.1), même convention que le chat.
  logUsage(
    opts.userId,
    opts.model,
    Math.round(usage.input + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1),
    usage.output,
    opts.feature,
  );

  if (message.stop_reason === "refusal") throw new ToolCallError("The model declined to write this message.");
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.tool.name);
  if (!block) {
    throw new ToolCallError(
      message.stop_reason === "max_tokens" ? "The AI response was cut off (too long). Retry." : "The AI did not return a structured answer. Retry.",
    );
  }
  return { input: block.input as T, model: opts.model, usage, stopReason: message.stop_reason };
}

// ── Petits helpers de parsing défensif des sorties d'outil ───────────────────

export function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function asStringArray(v: unknown, max = 20): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => asString(x).trim())
        .filter(Boolean)
        .slice(0, max)
    : [];
}

export function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}
