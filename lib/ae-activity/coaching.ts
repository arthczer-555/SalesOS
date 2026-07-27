// ────────────────────────────────────────────────────────────────────────
// Coaching auto par rep, synthétisé depuis Sales Coach.
//
// On agrège les analyses Claap déjà en base (sales_coach_analyses.analysis :
// weaknesses, coaching_priorities, risks, objections des key_moments) puis
// Claude en tire 3-5 axes de coaching actionnables. Remplace le bloc
// "Objections & coaching" écrit à la main dans le dashboard HTML.
// ────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import type { Coaching } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

type AnalysisJson = {
  meeting_kind?: string;
  weaknesses?: string[];
  coaching_priorities?: string[];
  risks?: string[];
  key_moments?: Array<{ kind?: string; label?: string; quote?: string }>;
};

const COACHING_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const MAX_ITEMS_PER_LIST = 40;

const SYSTEM_PROMPT = `Tu es un sales manager qui synthétise le coaching d'un commercial (AE) à partir de signaux agrégés sur ses meetings récents (points faibles récurrents, priorités de coaching, risques, objections rencontrées).

Ta mission : produire 3 à 5 constats de coaching ACTIONNABLES et spécifiques, chacun 1 à 2 phrases. Chaque constat doit :
- pointer un pattern récurrent (pas un one-off), avec la fréquence si pertinente,
- être concret et orienté action (ce que le commercial devrait changer),
- rester factuel : n'invente rien qui ne soit pas dans les signaux fournis.

N'utilise JAMAIS le tiret long (em dash). Écris en français. Réponds UNIQUEMENT via l'outil emit_coaching.`;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_coaching",
  description: "Renvoie 3 à 5 constats de coaching synthétiques pour ce commercial.",
  input_schema: {
    type: "object" as const,
    properties: {
      insights: {
        type: "array",
        items: { type: "string" },
        description: "3 à 5 constats de coaching, 1-2 phrases chacun.",
      },
    },
    required: ["insights"],
  },
};

function dedupeTop(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
    if (out.length >= MAX_ITEMS_PER_LIST) break;
  }
  return out;
}

async function synthesize(
  repName: string,
  meetingsCount: number,
  lists: { weaknesses: string[]; priorities: string[]; risks: string[]; objections: string[] },
): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const model = await getModelPreference("sales_coach", COACHING_FALLBACK_MODEL);

  const block = (title: string, items: string[]) =>
    items.length ? `${title} :\n${items.map((i) => `- ${i}`).join("\n")}` : "";
  const userMsg = [
    `Commercial : ${repName}`,
    `Meetings analysés : ${meetingsCount}`,
    ``,
    block("Points faibles récurrents", dedupeTop(lists.weaknesses)),
    block("Priorités de coaching", dedupeTop(lists.priorities)),
    block("Risques signalés", dedupeTop(lists.risks)),
    block("Objections rencontrées (verbatim)", dedupeTop(lists.objections)),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const client = anthropicClient({ timeout: 40_000 });
    const msg = await client.messages.create({
      model,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      tools: [EMIT_TOOL],
      tool_choice: { type: "tool" as const, name: "emit_coaching" },
    });
    logUsage(null, model, msg.usage.input_tokens, msg.usage.output_tokens, "ae_coaching");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) return [];
    const input = toolBlock.input as { insights?: unknown };
    if (!Array.isArray(input.insights)) return [];
    return input.insights
      .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      .map((i) => i.trim())
      .slice(0, 5);
  } catch (e) {
    console.warn(`[ae-activity] coaching synth failed for ${repName}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Construit le coaching d'un rep depuis ses analyses Sales Coach depuis
 * `startDay`. Best-effort partout : renvoie des insights vides plutôt que throw.
 */
export async function buildCoaching(userId: string, repName: string, startDay: string): Promise<Coaching> {
  const empty: Coaching = { insights: [], meetingsAnalyzed: 0, generatedAt: null };
  try {
    const { data } = await db
      .from("sales_coach_analyses")
      .select("analysis, meeting_started_at")
      .eq("user_id", userId)
      .not("analysis", "is", null)
      .gte("meeting_started_at", `${startDay}T00:00:00Z`)
      .order("meeting_started_at", { ascending: false })
      .limit(60);

    const rows = (data ?? []) as Array<{ analysis: AnalysisJson | null }>;
    if (rows.length === 0) return empty;

    const weaknesses: string[] = [];
    const priorities: string[] = [];
    const risks: string[] = [];
    const objections: string[] = [];
    for (const row of rows) {
      const a = row.analysis ?? {};
      (a.weaknesses ?? []).forEach((w) => w && weaknesses.push(w));
      (a.coaching_priorities ?? []).forEach((p) => p && priorities.push(p));
      (a.risks ?? []).forEach((r) => r && risks.push(r));
      (a.key_moments ?? []).forEach((k) => {
        if (k?.kind === "objection") {
          const txt = k.quote || k.label;
          if (txt) objections.push(txt);
        }
      });
    }

    if (weaknesses.length + priorities.length + risks.length + objections.length === 0) {
      return { insights: [], meetingsAnalyzed: rows.length, generatedAt: new Date().toISOString() };
    }

    const insights = await synthesize(repName, rows.length, { weaknesses, priorities, risks, objections });
    return { insights, meetingsAnalyzed: rows.length, generatedAt: new Date().toISOString() };
  } catch (e) {
    console.warn(`[ae-activity] coaching failed for ${userId}:`, e instanceof Error ? e.message : e);
    return empty;
  }
}
