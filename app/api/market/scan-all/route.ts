import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

async function searchTavily(query: string, days = 30): Promise<{ results: TavilyResult[]; error?: string }> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { results: [], error: "no_api_key" };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "advanced", max_results: 10, days }),
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

async function runScan(scope = "France"): Promise<{
  signals: { company_name: string; signal_type: string; title: string; summary: string; signal_date: string | null; strength: number; source_url: string | null }[];
  error?: string;
}> {
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
  const allResults = allResponses.flatMap((r) => r.results);

  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (uniqueResults.length === 0) return { signals: [], error: "tavily_empty" };

  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const sourcesText = uniqueResults
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.published_date ? `\nDate: ${r.published_date}` : ""}\n${r.content.slice(0, 400)}`)
    .join("\n\n---\n\n");

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    system: `Tu es un analyste commercial pour Coachello (coaching professionnel B2B, France/Europe). Coachello cible les entreprises en croissance ou en transformation qui ont besoin de développer leurs managers et leaders.`,
    messages: [{
      role: "user",
      content: `Nous sommes le ${today}.

Voici ${uniqueResults.length} articles collectés sur le marché ${scope} :
${sourcesText}

Extrais TOUTES les entreprises nommées qui montrent un signal d'achat pour Coachello (levée, recrutement, nomination DRH, expansion, restructuration).
Sois inclusif. Pour chaque signal :
- company_name, signal_type ('funding'|'hiring'|'nomination'|'expansion'|'restructuring'|'content')
- title (< 80 chars), summary (2-3 phrases), signal_date ("YYYY-MM" ou null)
- strength (3 = levée >10M€ ou C-suite, 2 = standard, 1 = faible), source_url

Réponds UNIQUEMENT en JSON valide :
{ "signals": [ { "company_name": "...", "signal_type": "...", "title": "...", "summary": "...", "signal_date": null, "strength": 2, "source_url": null } ] }`,
    }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { signals: [], error: "claude_no_json" };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { signals: parsed.signals ?? [] };
  } catch {
    return { signals: [], error: "json_parse_error" };
  }
}

export async function POST(req: NextRequest) {
  try {
    // Accept logged-in user OR Vercel cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let callerUserId: string | null = null;
    if (!isCron) {
      const user = await getAuthenticatedUser();
      if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
      callerUserId = user.id;
    }

    // Run one Tavily+Claude scan shared across all users
    const { signals, error } = await runScan("France");

    if (signals.length === 0) {
      return NextResponse.json({ signals: 0, companies: 0, users: 0, error });
    }

    // Fetch all user IDs to broadcast signals to
    const { data: allUsers } = await db.from("users").select("id");
    const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

    if (userIds.length === 0) {
      return NextResponse.json({ signals: 0, companies: 0, users: 0 });
    }

    const companies = [...new Set(signals.map((s) => s.company_name))];

    // For each user: delete old signals for detected companies, insert fresh
    for (const userId of userIds) {
      for (const company of companies) {
        await db.from("market_signals").delete().eq("user_id", userId).eq("company_name", company);
      }
      await db.from("market_signals").insert(
        signals.map((s) => ({
          user_id: userId,
          company_name: s.company_name,
          signal_type: s.signal_type,
          title: s.title,
          summary: s.summary,
          signal_date: s.signal_date ?? null,
          strength: s.strength ?? 2,
          source_url: s.source_url ?? null,
        }))
      );
    }

    // Log usage against caller or first user
    const logUserId = callerUserId ?? userIds[0];
    if (logUserId) {
      // Re-use logUsage — we don't have token counts here so we skip
      void logUserId;
    }

    return NextResponse.json({ signals: signals.length, companies: companies.length, users: userIds.length });
  } catch (e) {
    console.error("scan-all error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
