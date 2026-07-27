import { reportInsufficientCredit } from "@/lib/credit-alert";
import { isCreditText } from "@/lib/credit-error";

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
  score?: number;
};

export async function searchTavily(
  query: string,
  opts: { days?: number; maxResults?: number; depth?: "basic" | "advanced" } = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: opts.depth ?? "basic",
        max_results: opts.maxResults ?? 5,
        days: opts.days ?? 90,
      }),
    });
    if (!res.ok) {
      // Recherche web best-effort ([] en cas d'échec) : sans alerte Slack, un
      // quota Tavily épuisé dégrade silencieusement briefings et watchlist.
      const text = await res.text().catch(() => "");
      if (res.status === 402 || res.status === 432 || isCreditText(text)) {
        await reportInsufficientCredit({
          provider: "Tavily",
          detail: text.slice(0, 300) || `HTTP ${res.status}`,
          context: "Tavily web search",
        });
      }
      return [];
    }
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}
