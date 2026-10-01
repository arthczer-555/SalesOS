/**
 * Outil recherche web (Tavily) de CoachelloAI (extrait de l'ancien core.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolModule } from "./types";

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

async function searchTavily(query: string, days = 30): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        days,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

const defs: Anthropic.Tool[] = [
  {
    name: "web_search",
    description: "Recherche sur le web en temps réel : actualité, concurrents, tendances, infos sur une entreprise externe.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête de recherche" },
        days: { type: "number", description: "Limiter aux résultats des N derniers jours (défaut : 30)" },
      },
      required: ["query"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    web_search: async (input) => {
      const results = await searchTavily(input.query as string, (input.days as number) ?? 30);
      if (results.length === 0) return "Aucun résultat trouvé pour cette recherche.";
      return JSON.stringify(results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content.slice(0, 1000),
        date: r.published_date,
      })));
    },
  },
};

export const webTools = module_;
