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

async function searchTavily(
  query: string,
  days = 30
): Promise<{ results: TavilyResult[]; error?: string }> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { results: [], error: "no_api_key" };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: 10,
        days,
        include_answer: false,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { results: [], error: `http_${res.status}: ${text.slice(0, 100)}` };
    }
    const data = await res.json();
    return { results: (data.results ?? []) as TavilyResult[] };
  } catch (e) {
    return { results: [], error: String(e) };
  }
}

export async function POST(req: NextRequest) {
  try {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const scope: string = body.scope ?? "France";

  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  // Simple natural-language queries — Tavily does semantic search, no boolean operators
  const searches = [
    `startup levée de fonds millions euros ${scope}`,
    `nomination directeur ressources humaines DRH ${scope}`,
    `entreprise recrutement massif managers ${scope}`,
    `expansion ouverture bureau international entreprise ${scope}`,
    `restructuration réorganisation entreprise ${scope}`,
    `startup scale-up croissance recrutement leadership ${scope}`,
    `Chief People Officer Head of People nommé entreprise ${scope}`,
  ];

  const allResponses = await Promise.all(searches.map((q) => searchTavily(q, 30)));

  // Collect errors for debug
  const errors = allResponses
    .map((r, i) => (r.error ? `[${i}] ${r.error}` : null))
    .filter(Boolean);

  const allResults = allResponses.flatMap((r) => r.results);

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Return early with debug info if Tavily found nothing
  if (uniqueResults.length === 0) {
    return NextResponse.json({
      signals: 0,
      companies: 0,
      debug: "tavily_empty",
      errors,
    });
  }

  // Truncate each article to 400 chars to keep the prompt manageable
  const sourcesText = uniqueResults
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}${r.published_date ? `\nDate: ${r.published_date}` : ""}\n${r.content.slice(0, 400)}`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `Tu es un analyste commercial pour Coachello (coaching professionnel B2B, France/Europe).
Coachello cible les entreprises en croissance ou en transformation qui ont besoin de développer leurs managers et leaders.

Signaux d'achat pour Coachello :
- Levée de fonds → l'entreprise va recruter et a besoin de structurer son management
- Nomination d'un nouveau DRH/CPO/CHRO → décideur à adresser, en train de construire son programme RH
- Recrutement massif de managers → besoin de coaching et d'onboarding managérial
- Expansion → nouveaux bureaux, nouveaux marchés → besoin de leadership
- Restructuration → accompagnement du changement, montée en compétences
`;

  const userPrompt = `Nous sommes le ${today}.

Voici ${uniqueResults.length} articles collectés sur le marché ${scope} :
${sourcesText}

Extrais TOUTES les entreprises nommées dans ces articles qui montrent un signal pertinent pour Coachello.
Sois inclusif : si une entreprise est mentionnée avec un fait concret (levée, recrutement, nomination, etc.), génère un signal.

Pour chaque signal :
- company_name: nom exact de l'entreprise dans l'article
- signal_type: 'funding' | 'hiring' | 'nomination' | 'expansion' | 'restructuring' | 'content'
- title: < 80 caractères, fait concret
- summary: 2-3 phrases avec les détails de l'article
- signal_date: "YYYY-MM" si disponible, sinon null
- strength: 3 si levée >10M€ ou nomination C-suite, 2 sinon, 1 si signal faible
- source_url: URL de l'article

Réponds UNIQUEMENT en JSON valide :
{ "signals": [ { "company_name": "...", "signal_type": "...", "title": "...", "summary": "...", "signal_date": null, "strength": 2, "source_url": null } ] }`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ signals: 0, companies: 0, debug: "claude_no_json", sources: uniqueResults.length, errors });
  }

  let parsed: { signals?: typeof signals };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json({ signals: 0, companies: 0, debug: "json_parse_error", sources: uniqueResults.length, errors });
  }

  const signals: {
    company_name: string;
    signal_type: string;
    title: string;
    summary: string;
    signal_date: string | null;
    strength: number;
    source_url: string | null;
  }[] = parsed.signals ?? [];

  if (signals.length === 0) {
    return NextResponse.json({ signals: 0, companies: 0, debug: "claude_empty", sources: uniqueResults.length, errors });
  }

  const companies = [...new Set(signals.map((s) => s.company_name))];

  for (const company of companies) {
    await db.from("market_signals").delete().eq("user_id", user.id).eq("company_name", company);
  }

  const { error: insertError } = await db.from("market_signals").insert(
    signals.map((s) => ({
      user_id: user.id,
      company_name: s.company_name,
      signal_type: s.signal_type,
      title: s.title,
      summary: s.summary,
      signal_date: s.signal_date ?? null,
      strength: s.strength ?? 2,
      source_url: s.source_url ?? null,
    }))
  );

  if (insertError) {
    console.error("market_signals insert error:", insertError);
    return NextResponse.json({ signals: 0, companies: 0, debug: "db_error", message: insertError.message });
  }

  return NextResponse.json({ signals: signals.length, companies: companies.length });

  } catch (e) {
    console.error("scan route error:", e);
    return NextResponse.json({ signals: 0, companies: 0, debug: "server_error", message: String(e) });
  }
}
