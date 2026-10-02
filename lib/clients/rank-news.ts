import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE_EN } from "@/lib/no-em-dash";
import type { NewsCategory, NewsImportance, NewsItem } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Tri des news par Claude Haiku, avec le regard d'un AM/CS qui gère un compte
// CLIENT (pas d'un commercial qui prospecte). Tavily + Google News renvoient
// beaucoup de bruit (cours de bourse, homonymes, marketing grand public) : on
// garde ce qui change quelque chose pour le compte (nouveau DRH ou CEO,
// restructuration, M&A, résultats, expansion, recrutement massif, régulation),
// avec une phrase "why it matters" affichée telle quelle dans l'UI (anglais).
// Best-effort : si l'IA échoue, on renvoie les items d'origine sans tag.

const NEWS_RANK_MODEL = "claude-haiku-4-5-20251001";

const CATEGORIES: NewsCategory[] = [
  "leadership",
  "restructuring",
  "acquisition",
  "results",
  "funding",
  "expansion",
  "hiring",
  "regulation",
  "product",
  "other",
];
const IMPORTANCE: NewsImportance[] = ["high", "medium", "low"];

const RANK_NEWS_TOOL: Anthropic.Tool = {
  name: "rank_news",
  description: "Rate how much each company news item matters for the account team managing this client.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "0-based index of the article in the list" },
            category: { type: "string", enum: CATEGORIES },
            importance: {
              type: "string",
              enum: IMPORTANCE,
              description:
                "high = changes something for the account now (new CHRO/CEO/People leader, layoffs or restructuring, M&A, major results, big expansion). medium = useful context (hiring wave, new sites, strategy). low = noise or not about this company.",
            },
            why_it_matters: {
              type: "string",
              description:
                "One short sentence in English for the AM/CS: the risk or opportunity for our coaching program. Empty for low.",
            },
            keep: {
              type: "boolean",
              description: "false for obvious noise: stock prices, homonyms, generic listicles, consumer marketing, sponsoring.",
            },
            duplicate_of: {
              type: ["number", "null"],
              description: "Index of an EARLIER article in the list covering the same event (same deal, same appointment), else null.",
            },
          },
          required: ["index", "category", "importance", "keep"],
        },
      },
    },
    required: ["items"],
  },
};

type RankResult = {
  index: number;
  category: NewsCategory;
  importance: NewsImportance;
  why_it_matters?: string;
  keep: boolean;
  duplicate_of?: number | null;
};

const IMPORTANCE_TO_INTEREST: Record<NewsImportance, number> = { high: 0.9, medium: 0.6, low: 0.2 };

export async function rankClientNews(
  items: NewsItem[],
  opts: { companyName: string; userId?: string | null; feature?: string; programContext?: string | null },
): Promise<{ items: NewsItem[]; ignored: number }> {
  if (items.length === 0 || !process.env.ANTHROPIC_API_KEY) return { items, ignored: 0 };

  const model = await getModelPreference("clients", NEWS_RANK_MODEL);

  const list = items
    .map((it, i) => {
      let host = "";
      try {
        host = new URL(it.url).hostname.replace(/^www\./, "");
      } catch {
        host = it.url;
      }
      const date = it.published_at ? ` · ${it.published_at.slice(0, 10)}` : "";
      return `[${i}] ${it.title} (${it.source_name || host}${date})\n${it.summary?.slice(0, 220) ?? ""}`;
    })
    .join("\n\n");

  const prompt = `Company: "${opts.companyName}". It is a CLIENT of Coachello (B2B leadership coaching for managers)${opts.programContext ? `: ${opts.programContext}` : ""}.
You help the Account Manager / Customer Success who manages this account. For each article below, give its category, its importance for the account team, a one-sentence "why it matters" (risk or opportunity for the coaching program, e.g. new People leader = new sponsor to meet, layoffs = budget risk, new stores = more managers to coach), keep=false if it is noise, and duplicate_of when several articles cover the same event (keep only the first).
Be concrete and sober in "why it matters": stick to what the article says, no speculation, no hype words.

${list}

${NO_EM_DASH_RULE_EN}`;

  let parsed: RankResult[] = [];
  try {
    const client = anthropicClient({ timeout: 120_000 });
    const msg = await withAnthropicRetry(
      () =>
        client.messages.create({
          model,
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
          tools: [RANK_NEWS_TOOL],
          tool_choice: { type: "tool" as const, name: "rank_news" },
        }),
      { label: `clients/rank-news` },
    );
    logUsage(opts.userId ?? null, model, msg.usage.input_tokens, msg.usage.output_tokens, opts.feature ?? "clients_news_rank");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (toolBlock && "input" in toolBlock) {
      const raw = (toolBlock.input as { items?: unknown }).items;
      if (Array.isArray(raw)) {
        parsed = raw.filter(
          (r): r is RankResult =>
            !!r && typeof r === "object" && typeof (r as RankResult).index === "number" && typeof (r as RankResult).importance === "string",
        );
      }
    }
  } catch (e) {
    console.warn(`[clients/rank-news] ranking failed for "${opts.companyName}":`, e instanceof Error ? e.message : e);
    return { items, ignored: 0 };
  }

  if (parsed.length === 0) return { items, ignored: 0 };

  const byIndex = new Map<number, RankResult>();
  for (const r of parsed) byIndex.set(r.index, r);

  const out: NewsItem[] = [];
  let ignored = 0;
  items.forEach((it, i) => {
    const r = byIndex.get(i);
    if (!r) {
      out.push(it);
      return;
    }
    const importance: NewsImportance = IMPORTANCE.includes(r.importance) ? r.importance : "low";
    const isDuplicate = typeof r.duplicate_of === "number" && r.duplicate_of >= 0 && r.duplicate_of < i;
    if (r.keep === false || importance === "low" || isDuplicate) {
      ignored++;
      return;
    }
    out.push({
      ...it,
      category: CATEGORIES.includes(r.category) ? r.category : "other",
      importance,
      interest: IMPORTANCE_TO_INTEREST[importance],
      why_it_matters: r.why_it_matters?.trim() || null,
    });
  });

  return { items: out, ignored };
}
