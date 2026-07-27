/**
 * Juge LLM de RAG Insights : catégorise chaque tour, estime la satisfaction et
 * dit ce qui ne va pas quand la réponse rate.
 *
 * Deux signaux de satisfaction :
 *   1. explicite : le 👍/👎 posé par le user sous la réponse (chat_jobs.feedback).
 *      Il prime toujours (borne le score du juge).
 *   2. inféré : cohérence de la réponse, présence de sources, et surtout la
 *      RÉACTION du user au tour suivant (reformulation, "non", "c'est pas ça").
 *
 * Conventions maison : batch, tool forcé plus parse manuel, withAnthropicRetry,
 * getModelPreference, logUsage. Sorties du modèle en anglais (l'UI et le recap
 * Slack le sont), les questions citées restent dans leur langue d'origine.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { NO_EM_DASH_RULE_EN, stripEmDashes } from "@/lib/no-em-dash";
import {
  RAG_CATEGORIES,
  RAG_VERDICTS,
  type RagCategory,
  type RagJudgement,
  type RagTurn,
  type RagVerdict,
} from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

const BATCH = 12;
const FALLBACK_MODEL = "claude-haiku-4-5-20251001";

const judgeTool: Anthropic.Tool = {
  name: "judge_turns",
  description: "Emits one judgement per analyzed turn.",
  input_schema: {
    type: "object" as const,
    properties: {
      judgements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "The [N] index of the analyzed turn" },
            category: { type: "string", enum: [...RAG_CATEGORIES] },
            is_knowledge: {
              type: "boolean",
              description:
                "true if the question is about Coachello itself (offering, pricing, programs, process, positioning, internal policies) and should be answered from the Notion knowledge base. false if it is about a specific client, deal, pipeline or prospecting task answered from the CRM.",
            },
            verdict: { type: "string", enum: [...RAG_VERDICTS] },
            satisfaction: { type: "number", description: "0 to 100" },
            answer_summary: { type: "string", description: "1 to 2 lines, in English, what the bot actually answered" },
            issue: { type: "string", description: "In English, what went wrong. Empty string if verdict is answered." },
            gap_summary: {
              type: "string",
              description:
                "In English, what was missing from the Notion knowledge base. Empty string if not a knowledge question or if nothing was missing.",
            },
            reasoning: { type: "string", description: "One line, in English" },
          },
          required: ["index", "category", "is_knowledge", "verdict", "satisfaction", "answer_summary", "issue", "gap_summary", "reasoning"],
        },
      },
    },
    required: ["judgements"],
  },
};

const SYSTEM = `You audit CoachelloGPT, the internal AI assistant of Coachello's sales team.

Coachello sells human coaching programs to companies. The assistant answers two kinds of questions:
- KNOWLEDGE questions about Coachello itself (offering, pricing, programs, pedagogy, internal process, positioning vs competitors, finance, HR). These must be answered from the Notion knowledge base, with a cited source.
- SALES questions about a specific client, deal, pipeline, meeting or prospecting task. These are answered from HubSpot, Slack, Gmail, Drive, Claap.

A large share of the traffic is marketing and CS content work (onboarding emails, video scripts, wording iterations). Use the marketing_content category for those. They still count as KNOWLEDGE questions whenever the copy depends on a fact about the product (what each user tier has access to, what a programme contains, brand guidelines): if the bot guessed that fact instead of reading it, say so in gap_summary.

For each turn you receive the question, the answer, the Notion pages the bot read, the guides it loaded, what the user said next, and an explicit thumbs up/down when the user gave one.

How to score satisfaction (0 to 100):
- 85-100: complete, coherent, and sourced when it is a knowledge question. The user moved on or was satisfied.
- 60-84: useful but incomplete, or partially sourced, or the user had to ask again for a detail.
- 35-59: honest admission that the information is missing, or a vague answer that does not resolve the question.
- 0-34: wrong, contradicted by the user right after, or a confident claim on a knowledge question with no source to back it.

Hard rules:
- An unsourced factual claim on a KNOWLEDGE question is a serious defect, even if the answer sounds right. The sales team repeats these claims to prospects.
- A clean "I could not find this in the knowledge base" is better than an invention: verdict missing_info, satisfaction around 45.
- If the next user message rephrases the same question, says no, corrects the bot, or shows frustration, lower the score and say so in issue.
- If the next user message moves to another topic or thanks the bot, that is a positive signal.
- verdict off_scope is for anything that is not a real question (test messages, greetings, single words).
- issue must be empty only when verdict is answered. Otherwise it names the concrete defect, in one or two sentences.
- gap_summary is filled only when a knowledge question failed because the Notion base does not hold the information. Describe the missing content, not the bot behaviour.
- Write every field in English. Never invent facts about Coachello: you judge the exchange, you do not answer the question yourself.

${NO_EM_DASH_RULE_EN}`;

type RawJudgement = {
  index?: number;
  category?: string;
  is_knowledge?: boolean;
  verdict?: string;
  satisfaction?: number;
  answer_summary?: string;
  issue?: string;
  gap_summary?: string;
  reasoning?: string;
};

function renderTurn(turn: RagTurn, index: number): string {
  const lines = [
    `[${index}] surface: ${turn.source} | asked at ${turn.askedAt.slice(0, 10)}`,
    `QUESTION: ${turn.question}`,
    `ANSWER: ${turn.answer}`,
    `NOTION PAGES READ: ${turn.notionPages.length > 0 ? turn.notionPages.map((p) => p.title).join(" ; ") : "(none)"}`,
    `GUIDES LOADED: ${turn.guidesLoaded.length > 0 ? turn.guidesLoaded.join(" ; ") : "(none)"}`,
    `USER SAID NEXT: ${turn.userReply ?? "(nothing, end of conversation)"}`,
  ];
  if (turn.feedback) {
    lines.push(`EXPLICIT FEEDBACK: thumbs ${turn.feedback}`);
  }
  return lines.join("\n");
}

function coerceCategory(raw: string | undefined): RagCategory {
  return (RAG_CATEGORIES as readonly string[]).includes(raw ?? "") ? (raw as RagCategory) : "other";
}

function coerceVerdict(raw: string | undefined): RagVerdict {
  return (RAG_VERDICTS as readonly string[]).includes(raw ?? "") ? (raw as RagVerdict) : "partial";
}

function clampScore(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function judgeBatch(turns: RagTurn[], model: string): Promise<Map<number, RagJudgement>> {
  const client = anthropicClient({ timeout: 120_000 });
  const list = turns.map((t, i) => renderTurn(t, i)).join("\n\n---\n\n");

  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 6000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Judge these ${turns.length} turns. Emit exactly one judgement per turn via judge_turns, copying the [N] index into "index".\n\n${list}`,
          },
        ],
        tools: [judgeTool],
        tool_choice: { type: "tool" as const, name: "judge_turns" },
      }),
    { label: "rag-insights/analyze" },
  );

  logUsage(null, model, msg.usage.input_tokens, msg.usage.output_tokens, "rag_insights");

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return new Map();
  const parsed = block.input as { judgements?: RawJudgement[] };

  const out = new Map<number, RagJudgement>();
  for (const j of parsed.judgements ?? []) {
    if (typeof j.index !== "number" || j.index < 0 || j.index >= turns.length) continue;
    out.set(j.index, {
      category: coerceCategory(j.category),
      isKnowledge: j.is_knowledge === true,
      verdict: coerceVerdict(j.verdict),
      satisfaction: clampScore(j.satisfaction),
      answerSummary: stripEmDashes((j.answer_summary ?? "").trim()),
      issue: stripEmDashes((j.issue ?? "").trim()),
      gapSummary: stripEmDashes((j.gap_summary ?? "").trim()),
      reasoning: stripEmDashes((j.reasoning ?? "").trim()),
    });
  }
  return out;
}

/** Le feedback explicite prime : il borne le score du juge. */
function applyFeedback(judgement: RagJudgement, feedback: "up" | "down" | null) {
  if (!feedback) return { satisfaction: judgement.satisfaction, basis: "inferred" as const };
  const satisfaction =
    feedback === "up"
      ? Math.max(80, judgement.satisfaction)
      : Math.min(30, judgement.satisfaction);
  return { satisfaction, basis: "explicit" as const };
}

/**
 * Analyse les tours par lots et persiste le résultat. Idempotent : la contrainte
 * UNIQUE (source, source_id, turn_index) absorbe les doublons.
 */
export async function analyzeTurns(turns: RagTurn[]): Promise<number> {
  if (turns.length === 0) return 0;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[rag-insights/analyze] ANTHROPIC_API_KEY manquante, analyse annulée");
    return 0;
  }

  const model = await getModelPreference("rag_insights", FALLBACK_MODEL);
  let inserted = 0;

  for (let i = 0; i < turns.length; i += BATCH) {
    const slice = turns.slice(i, i + BATCH);
    const judgements = await judgeBatch(slice, model).catch((e) => {
      console.warn(
        "[rag-insights/analyze] batch failed:",
        e instanceof Error ? e.message : e,
      );
      return new Map<number, RagJudgement>();
    });
    if (judgements.size === 0) continue;

    const rows = [];
    for (const [index, judgement] of judgements) {
      const turn = slice[index];
      const { satisfaction, basis } = applyFeedback(judgement, turn.feedback);
      rows.push({
        source: turn.source,
        source_id: turn.sourceId,
        turn_index: turn.turnIndex,
        user_id: turn.userId,
        asked_at: turn.askedAt,
        question: turn.question,
        answer_excerpt: turn.answer.slice(0, 2000),
        answer_summary: judgement.answerSummary || null,
        issue: judgement.issue || null,
        category: judgement.category,
        is_knowledge: judgement.isKnowledge,
        used_notion: turn.notionPages.length > 0,
        notion_pages: turn.notionPages,
        guides_loaded: turn.guidesLoaded,
        verdict: judgement.verdict,
        satisfaction,
        satisfaction_basis: basis,
        gap_summary: judgement.gapSummary || null,
        reasoning: judgement.reasoning || null,
        model,
      });
    }

    const { error } = await db
      .from("rag_question_analyses")
      .upsert(rows, { onConflict: "source,source_id,turn_index", ignoreDuplicates: true });
    if (error) console.error("[rag-insights/analyze] insert failed:", error.message);
    else inserted += rows.length;
  }

  return inserted;
}

/**
 * Un 👍/👎 peut arriver APRÈS l'analyse du tour (le user note une vieille
 * réponse). Comme un tour n'est jamais réanalysé, on resynchronise ici les
 * scores des rows dont le feedback explicite n'a pas encore été pris en compte.
 */
export async function syncExplicitFeedback(sinceDays: number): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  const { data: jobs, error } = await db
    .from("chat_jobs")
    .select("id, feedback")
    .not("feedback", "is", null)
    .gte("created_at", since)
    .limit(2000);
  if (error || !jobs || jobs.length === 0) return 0;

  const { data: rows } = await db
    .from("rag_question_analyses")
    .select("id, source_id, satisfaction, satisfaction_basis")
    .eq("source", "web")
    .gte("asked_at", since)
    .neq("satisfaction_basis", "explicit")
    .limit(2000);
  if (!rows || rows.length === 0) return 0;

  const feedbackById = new Map(jobs.map((j) => [j.id as string, j.feedback as string]));
  let updated = 0;

  for (const row of rows) {
    const feedback = feedbackById.get(row.source_id as string);
    if (feedback !== "up" && feedback !== "down") continue;
    const current = typeof row.satisfaction === "number" ? row.satisfaction : 50;
    const satisfaction = feedback === "up" ? Math.max(80, current) : Math.min(30, current);
    const { error: updateError } = await db
      .from("rag_question_analyses")
      .update({ satisfaction, satisfaction_basis: "explicit" })
      .eq("id", row.id);
    if (!updateError) updated++;
  }

  return updated;
}
