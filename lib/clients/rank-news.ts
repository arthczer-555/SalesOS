import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import type { News, NewsCategory } from "./types";

// Tri/filtrage des news par Claude Haiku. Tavily renvoie jusqu'à 8 résultats
// bruts (souvent du bruit : tickers boursiers, homonymes, listicles). Ici on
// catégorise chaque item, on note son intérêt pour un CS qui gère le compte,
// on vire le bruit et on trie. Best-effort : si l'IA échoue ou renvoie un
// shape cassé, on retourne les items d'origine (jamais de perte totale).

const NEWS_RANK_MODEL = "claude-haiku-4-5-20251001";
const INTEREST_THRESHOLD = 0.3;

const CATEGORIES: NewsCategory[] = [
  "funding",
  "hiring",
  "acquisition",
  "leadership",
  "product",
  "other",
];

const RANK_NEWS_TOOL: Anthropic.Tool = {
  name: "rank_news",
  description:
    "Catégorise et note l'intérêt de chaque actualité d'entreprise pour un Customer Success qui gère ce compte.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "Index de l'article dans la liste fournie (0-based)" },
            category: {
              type: "string",
              enum: CATEGORIES,
              description:
                "funding (levée), hiring (recrutement massif), acquisition (M&A), leadership (changement de dirigeant), product (lancement/produit), other (le reste)",
            },
            interest: {
              type: "number",
              description:
                "Intérêt 0..1 pour un CS qui gère ce compte (signal business actionnable = haut, bruit/non pertinent = bas)",
            },
            keep: {
              type: "boolean",
              description: "false si bruit évident : cours de bourse, homonyme, listicle générique, hors-sujet",
            },
          },
          required: ["index", "category", "interest", "keep"],
        },
      },
    },
    required: ["items"],
  },
};

type RankResult = { index: number; category: NewsCategory; interest: number; keep: boolean };

export async function rankClientNews(
  items: News["items"],
  opts: { companyName: string; userId?: string | null; feature?: string },
): Promise<News["items"]> {
  if (items.length === 0 || !process.env.ANTHROPIC_API_KEY) return items;

  const list = items
    .map((it, i) => {
      let host = "";
      try {
        host = new URL(it.url).hostname.replace(/^www\./, "");
      } catch {
        host = it.url;
      }
      return `[${i}] ${it.title} (${host})\n${it.summary?.slice(0, 200) ?? ""}`;
    })
    .join("\n\n");

  const prompt = `Entreprise : "${opts.companyName}".
Voici ${items.length} actualités candidates récupérées par recherche web. Pour chacune, donne sa catégorie, un score d'intérêt 0..1 pour un Customer Success qui gère ce compte, et keep=false si c'est du bruit (cours de bourse, homonyme d'une autre boîte, listicle générique, hors-sujet).

${list}`;

  let parsed: RankResult[] = [];
  try {
    const client = new Anthropic({ timeout: 120_000 });
    const msg = await withAnthropicRetry(
      () =>
        client.messages.create({
          model: NEWS_RANK_MODEL,
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
          tools: [RANK_NEWS_TOOL],
          tool_choice: { type: "tool" as const, name: "rank_news" },
        }),
      { label: `clients/rank-news` },
    );
    logUsage(
      opts.userId ?? null,
      NEWS_RANK_MODEL,
      msg.usage.input_tokens,
      msg.usage.output_tokens,
      opts.feature ?? "clients_news_rank",
    );

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (toolBlock && "input" in toolBlock) {
      const raw = (toolBlock.input as { items?: unknown }).items;
      if (Array.isArray(raw)) {
        parsed = raw.filter(
          (r): r is RankResult =>
            !!r &&
            typeof r === "object" &&
            typeof (r as RankResult).index === "number" &&
            typeof (r as RankResult).interest === "number",
        );
      }
    }
  } catch (e) {
    console.warn(
      `[clients/rank-news] ranking failed for "${opts.companyName}":`,
      e instanceof Error ? e.message : e,
    );
    return items;
  }

  if (parsed.length === 0) return items;

  // Enrichit chaque item avec sa note, filtre le bruit, trie par intérêt
  // (tie-break : score Tavily). Un item non noté par l'IA est conservé sans tag.
  const byIndex = new Map<number, RankResult>();
  for (const r of parsed) byIndex.set(r.index, r);

  const enriched = items.map((it, i) => {
    const r = byIndex.get(i);
    if (!r) return { item: it, keep: true, interest: it.relevance ?? 0 };
    return {
      item: {
        ...it,
        category: CATEGORIES.includes(r.category) ? r.category : ("other" as NewsCategory),
        interest: r.interest,
      },
      keep: r.keep !== false && r.interest >= INTEREST_THRESHOLD,
      interest: r.interest,
    };
  });

  const kept = enriched.filter((e) => e.keep);
  // Si le filtre vire tout (IA trop sévère), on garde les items non filtrés.
  const final = kept.length > 0 ? kept : enriched;

  return final
    .sort((a, b) => {
      if (b.interest !== a.interest) return b.interest - a.interest;
      return (b.item.relevance ?? 0) - (a.item.relevance ?? 0);
    })
    .map((e) => e.item);
}
