import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Tavily search ───────────────────────────────────────────────────────────

type TavilyResult = { title: string; url: string; content: string; score: number };

async function searchTavily(query: string, days = 365): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, days }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch { return []; }
}

// ─── Configuration ───────────────────────────────────────────────────────────

export const COMPETITORS = [
  { name: "CoachHub", domain: "coachhub.com" },
  { name: "BetterUp", domain: "betterup.com" },
  { name: "Ezra", domain: "ezra.com" },
  { name: "Simundia", domain: "simundia.com" },
];

export const COACHING_TOPICS: { query: string; label: string }[] = [
  { query: "coaching performance commerciale", label: "Sales coaching & performance" },
  { query: "ROI coaching entreprise", label: "Coaching ROI" },
  { query: "coaching intelligence artificielle IA", label: "AI & Coaching" },
  { query: "coaching santé mentale bien-être travail", label: "Mental health & wellbeing" },
  { query: "coaching équipes tech développeurs", label: "Coaching for tech teams" },
  { query: "coaching intergénérationnel", label: "Intergenerational coaching" },
  { query: "coaching onboarding intégration", label: "Onboarding & coaching" },
  { query: "leadership coaching management", label: "Leadership coaching" },
  { query: "coaching digital hybride remote", label: "Digital / hybrid coaching" },
  { query: "soft skills développement compétences", label: "Soft skills development" },
  { query: "coaching diversité inclusion", label: "Diversity & inclusion" },
  { query: "mesure impact coaching KPI", label: "Coaching impact measurement" },
];

// Check which topics Coachello covers (via WordPress)
async function fetchCoachelloTopics(): Promise<Set<string>> {
  const wpApi = process.env.WORDPRESS_API_URL || "https://coachello.ai/wp-json/wp/v2";
  try {
    const res = await fetch(`${wpApi}/posts?per_page=100&_fields=title&orderby=date&order=desc`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return new Set();
    const posts: { title: { rendered: string } }[] = await res.json();
    const titles = posts.map((p) => p.title.rendered.toLowerCase());
    const covered = new Set<string>();
    for (const topic of COACHING_TOPICS) {
      const keywords = topic.query.toLowerCase().split(" ");
      if (titles.some((t) => keywords.some((k) => k.length > 3 && t.includes(k)))) {
        covered.add(topic.query);
      }
    }
    return covered;
  } catch { return new Set(); }
}

// ─── Benchmark scan ──────────────────────────────────────────────────────────

interface DynamicCompetitorBenchmark {
  topic: string;
  coachello: boolean;
  competitors: Record<string, boolean>;
}

async function scanCompetitors(
  topics: { query: string; label: string }[],
  coachelloTopics: Set<string>,
): Promise<DynamicCompetitorBenchmark[]> {
  const results: Map<string, Map<string, boolean>> = new Map();
  for (const comp of COMPETITORS) results.set(comp.name, new Map());

  const queries: { competitor: string; topicQuery: string; searchQuery: string }[] = [];
  for (const comp of COMPETITORS) {
    for (const topic of topics) {
      queries.push({ competitor: comp.name, topicQuery: topic.query, searchQuery: `site:${comp.domain} ${topic.query}` });
    }
  }

  const batchSize = 4;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((q) => searchTavily(q.searchQuery)));
    batch.forEach((q, j) => { results.get(q.competitor)!.set(q.topicQuery, batchResults[j].length > 0); });
  }

  return topics.map((topic) => {
    const competitors: Record<string, boolean> = {};
    for (const comp of COMPETITORS) competitors[comp.name] = results.get(comp.name)?.get(topic.query) ?? false;
    return { topic: topic.label, coachello: coachelloTopics.has(topic.query), competitors };
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Return empty state — user must click "Scan" to trigger Tavily
  const coachelloTopics = await fetchCoachelloTopics();
  const defaultBenchmarks = COACHING_TOPICS.map((t) => ({
    topic: t.label,
    coachello: coachelloTopics.has(t.query),
    competitors: Object.fromEntries(COMPETITORS.map((c) => [c.name, false])),
  }));

  return NextResponse.json({
    competitors: defaultBenchmarks,
    competitorNames: COMPETITORS.map((c) => c.name),
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let extraTopics: string[] = [];
  try {
    const body = await req.json();
    extraTopics = Array.isArray(body.extraTopics) ? body.extraTopics : [];
  } catch {}

  const allTopics = [...COACHING_TOPICS, ...extraTopics.map((t) => ({ query: t, label: t }))];

  try {
    const coachelloTopics = await fetchCoachelloTopics();
    const competitors = await scanCompetitors(allTopics, coachelloTopics);
    return NextResponse.json({ competitors, competitorNames: COMPETITORS.map((c) => c.name) });
  } catch (e) {
    console.error("[marketing/recommendations] Tavily scan failed:", e);
    return NextResponse.json({
      competitors: [],
      competitorNames: COMPETITORS.map((c) => c.name),
      error: "Scan failed. Check your Tavily API key.",
    });
  }
}
