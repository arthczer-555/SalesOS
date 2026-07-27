import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { BUSINESS_CONTEXT, BUSINESS_CONTEXT_HASH } from "@/lib/business-context";
import { stripEmDashes } from "@/lib/no-em-dash";
import type { Keyword, KeywordRelevance } from "@/lib/marketing-types";
import { anthropicClient } from "@/lib/anthropic-client";

const BATCH_SIZE = 40;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_keywords",
  description:
    "Classify each SEO keyword by its business relevance to Coachello's B2B leadership-coaching market",
  input_schema: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description: "Exact keyword as provided, lowercased",
            },
            score: {
              type: "integer",
              description:
                "Relevance 0-100. Use the full scale: irrelevant <25, partial/tangential 25-60, strong B2B L&D fit 60-85, bullseye ICP-aligned 85-100. Do NOT cluster around 50.",
            },
            category: {
              type: "string",
              enum: ["relevant", "partial", "irrelevant"],
              description:
                "relevant = clearly B2B leadership/L&D topic; partial = adjacent but ambiguous; irrelevant = outside the market (teens, yoga, sports, etc.)",
            },
            reason: {
              type: "string",
              description:
                "Max 15 words. State the business angle, referencing either relevantTopics or excludedTopics.",
            },
          },
          required: ["keyword", "score", "category", "reason"],
        },
      },
    },
    required: ["classifications"],
  },
};

function buildPrompt(keywords: string[]): string {
  return `You classify SEO keywords by COMMERCIAL BUYER INTENT for Coachello.

## Coachello
${BUSINESS_CONTEXT.company}
Target buyers: ${BUSINESS_CONTEXT.audience.join(", ")}
Core offerings: ${BUSINESS_CONTEXT.coreActivities.join("; ")}

## What IS relevant - an HR/L&D decision-maker evaluating coaching solutions
${BUSINESS_CONTEXT.relevantTopics.map((t) => "- " + t).join("\n")}

## What is EXPLICITLY NOT relevant (cap score at 15-20, category "irrelevant")
${BUSINESS_CONTEXT.excludedTopics.map((t) => "- " + t).join("\n")}

## THE CORE TEST
Ask: "Does this query represent an HR/L&D buyer actively researching or considering a B2B coaching platform?"
Not "is this HR-adjacent?" - that's too lenient. The keyword must move a buyer closer to purchase.

## Scoring scale - use the full 0-100 range, do NOT default to 50
- 90-100 bullseye: explicit buyer intent, e.g. "leadership coaching platform for enterprise", "executive coaching ROI", "best coaching software for L&D"
- 70-89 strong: clear B2B HR buyer topic, e.g. "first-time manager training programs", "scaling leadership development", "measuring coaching effectiveness"
- 40-69 partial: leadership/coaching theme but audience or intent is ambiguous, e.g. "what is team coaching", "coaching styles explained"
- 15-39 weak: HR-adjacent but not buyer intent - employee self-help, definition lookups, niche HR concepts with no purchase signal, e.g. "survivor syndrome", "career advice after layoff"
- 0-14 irrelevant: matches excluded list - branded queries, consumer wellness, job-seeker content, lifestyle listicles, generic "questions to ask" formats

## Concrete anti-patterns - classify these as irrelevant/weak, NOT relevant
- Branded queries naming Coachello, its URL, or competitor brand names → irrelevant (score ≤15)
- Employee-side content ("survivor syndrome", "how to cope with", "career change") → weak (score ≤35) unless clearly reframed for HR action
- Definition/academic lookups ("what is X", "X meaning") → partial (score ~45) unless the concept is clearly buyer-intent
- Generic listicles ("bucket list", "icebreaker questions", "fun team activities") → irrelevant (score ≤20)
- Certification/how-to-become-a-coach content → irrelevant (we sell to buyers, not coaches-in-training)
- Non-English keywords use the same axis - language is not a factor

## Keywords to classify (${keywords.length})
${keywords.map((k, i) => `${i + 1}. "${k}"`).join("\n")}

Call \`classify_keywords\`. One entry per keyword, keyword field lowercased exactly as given.`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

async function classifyBatch(
  client: Anthropic,
  userId: string,
  keywords: string[],
): Promise<KeywordRelevance[]> {
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_keywords" },
    messages: [{ role: "user", content: buildPrompt(keywords) }],
  });

  logUsage(
    userId,
    CLAUDE_MODEL,
    message.usage.input_tokens,
    message.usage.output_tokens,
    "marketing_keyword_relevance",
  );

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `classify_keywords: no tool_use block. stop_reason=${message.stop_reason}`,
    );
  }

  const parsed = toolUse.input as {
    classifications: Array<{
      keyword: string;
      score: number;
      category: "relevant" | "partial" | "irrelevant";
      reason: string;
    }>;
  };

  return parsed.classifications.map((c) => ({
    keyword: c.keyword.trim().toLowerCase(),
    relevanceScore: clamp(Math.round(c.score), 0, 100),
    category: c.category,
    reason: stripEmDashes(c.reason ?? "").slice(0, 240),
  }));
}

/**
 * Classify a batch of keywords by business relevance.
 * Returns a Map keyed by lowercased+trimmed keyword.
 * Uses Supabase cache scoped by BUSINESS_CONTEXT_HASH.
 */
export async function classifyKeywords(
  userId: string,
  keywords: Keyword[],
): Promise<Map<string, KeywordRelevance>> {
  const out = new Map<string, KeywordRelevance>();
  if (keywords.length === 0) return out;

  const uniqueKeywords = Array.from(
    new Set(keywords.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)),
  );
  if (uniqueKeywords.length === 0) return out;

  // 1. Read cache scoped to the CURRENT business-context hash
  const { data: cached } = await db
    .from("marketing_keyword_relevance")
    .select("keyword, relevance_score, category, reason")
    .eq("user_id", userId)
    .eq("context_hash", BUSINESS_CONTEXT_HASH)
    .in("keyword", uniqueKeywords);

  for (const row of (cached as Array<{
    keyword: string;
    relevance_score: number;
    category: KeywordRelevance["category"];
    reason: string | null;
  }> | null) ?? []) {
    out.set(row.keyword, {
      keyword: row.keyword,
      relevanceScore: row.relevance_score,
      category: row.category,
      reason: row.reason ?? "",
    });
  }

  // 2. Determine which keywords need classification
  const uncached = uniqueKeywords.filter((k) => !out.has(k));
  if (uncached.length === 0) return out;

  // 3. Batch and call Claude in parallel
  const client = anthropicClient();
  const batches = chunk(uncached, BATCH_SIZE);
  const newRows: Array<{
    user_id: string;
    keyword: string;
    relevance_score: number;
    category: string;
    reason: string;
    context_hash: string;
  }> = [];

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      try {
        const results = await classifyBatch(client, userId, batch);
        return { batch, results, error: null as Error | null };
      } catch (err) {
        console.error("[classifyKeywords] batch failed", err);
        return { batch, results: [] as KeywordRelevance[], error: err as Error };
      }
    }),
  );

  for (const { batch, results, error } of batchResults) {
    if (error) {
      for (const k of batch) {
        out.set(k, {
          keyword: k,
          relevanceScore: 50,
          category: "partial",
          reason: "classification unavailable — fail-open",
        });
      }
      continue;
    }

    const returned = new Set(results.map((r) => r.keyword));
    for (const r of results) {
      out.set(r.keyword, r);
      newRows.push({
        user_id: userId,
        keyword: r.keyword,
        relevance_score: r.relevanceScore,
        category: r.category,
        reason: r.reason,
        context_hash: BUSINESS_CONTEXT_HASH,
      });
    }

    // Fill any keywords Claude omitted with a fail-open default (not persisted)
    for (const k of batch) {
      if (!returned.has(k)) {
        out.set(k, {
          keyword: k,
          relevanceScore: 50,
          category: "partial",
          reason: "classification missing from batch — fail-open",
        });
      }
    }
  }

  // 4. Persist new classifications
  if (newRows.length > 0) {
    const { error } = await db
      .from("marketing_keyword_relevance")
      .upsert(newRows, { onConflict: "user_id,keyword" });
    if (error) console.error("[classifyKeywords] upsert failed:", error.message);
  }

  return out;
}
