import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

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
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, days }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

// GET — list signals for current user (last 100)
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");

  let query = db
    .from("market_signals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (type) query = query.eq("signal_type", type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// POST — generate signals for a company via Tavily + Claude
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { company } = await req.json();
  if (!company?.trim()) return NextResponse.json({ error: "company manquant" }, { status: 400 });

  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  // Parallel Tavily searches
  const searches = [
    `${company} actualités`,
    `${company} levée de fonds financement série`,
    `${company} recrutement DRH CPO nominations leadership`,
    `${company} expansion ouverture bureau partenariat`,
    `${company} restructuration licenciements réorganisation`,
  ];

  const allResultsNested = await Promise.all(searches.map((q) => searchTavily(q, 30)));
  const allResults = allResultsNested.flat();

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const sourcesText = uniqueResults.length > 0
    ? uniqueResults.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}${r.published_date ? `\nDate: ${r.published_date}` : ""}\n${r.content}`
      ).join("\n\n---\n\n")
    : "Aucun résultat trouvé pour cette période.";

  const systemPrompt = `Tu es un analyste en intelligence commerciale pour Coachello, spécialiste du coaching B2B en France et en Europe.
Ton rôle : détecter des signaux d'achat potentiels pour Coachello dans les actualités d'entreprises prospects.
Les meilleurs signaux pour Coachello : levées de fonds (besoin de structurer les équipes), nominations RH/L&D (nouveau décideur à adresser), recrutements massifs (besoin de coaching managers), expansion (nouveaux besoins de développement leadership), restructurations (besoin d'accompagnement du changement).`;

  const userPrompt = `Nous sommes le ${today}. Analyse les actualités du dernier mois (depuis le ${monthAgo}).

Entreprise : ${company}

Sources trouvées :
${sourcesText}

RÈGLES :
1. Ne génère un signal QUE si une source contient un fait précis et documenté.
2. Sources génériques (page À propos, articles sans date) → ignorées.
3. Si rien de notable → retourne "signals": [].
4. Chaque signal doit avoir une pertinence claire pour Coachello (coaching, leadership, RH, L&D).

Pour chaque signal :
- signal_type: 'funding' | 'hiring' | 'nomination' | 'expansion' | 'restructuring' | 'content'
- title: titre court (< 80 caractères)
- summary: 2-3 phrases factuelles avec détails concrets
- signal_date: format "YYYY-MM" ou null
- strength: 1 (faible) | 2 (moyen) | 3 (fort) selon la pertinence pour Coachello
- source_url: URL de la source ou null

Réponds UNIQUEMENT en JSON valide :
{ "signals": [ { "signal_type": "...", "title": "...", "summary": "...", "signal_date": null, "strength": 2, "source_url": null } ] }`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({ signals: 0 });

  const parsed = JSON.parse(jsonMatch[0]);
  const signals: {
    signal_type: string;
    title: string;
    summary: string;
    signal_date: string | null;
    strength: number;
    source_url: string | null;
  }[] = parsed.signals ?? [];

  // Delete old signals for this company+user, insert fresh ones
  await db.from("market_signals").delete().eq("user_id", user.id).eq("company_name", company);

  if (signals.length > 0) {
    await db.from("market_signals").insert(
      signals.map((s) => ({
        user_id: user.id,
        company_name: company,
        signal_type: s.signal_type,
        title: s.title,
        summary: s.summary,
        signal_date: s.signal_date ?? null,
        strength: s.strength ?? 2,
        source_url: s.source_url ?? null,
      }))
    );
  }

  return NextResponse.json({ signals: signals.length });
}
