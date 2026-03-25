import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
};

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "advanced", max_results: 8, days: 180 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

async function extractFromSources(
  company: string,
  sourcesText: string,
  userId: string
): Promise<{ name: string; title: string; linkedin_url: string | null; source_url: string; source: "web" }[]> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Tu extrais des informations sur des personnes à partir d'articles web. Tu retournes uniquement les personnes clairement nommées avec leur rôle chez ${company}.`,
    messages: [{
      role: "user",
      content: `Entreprise : ${company}

Sources :
${sourcesText}

Extrais toutes les personnes nommées qui travaillent ou ont travaillé chez ${company}, avec leur rôle.
Concentre-toi sur les décideurs RH, L&D, direction générale, CPO, DRH.
Ne génère que des personnes explicitement nommées dans les sources.

Réponds UNIQUEMENT en JSON :
{ "contacts": [ { "name": "Prénom Nom", "title": "Poste", "linkedin_url": null, "source_url": "URL" } ] }`,
    }],
  });

  logUsage(userId, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "market_contacts");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.contacts ?? []).map((c: { name: string; title: string; linkedin_url: string | null; source_url: string }) => ({ ...c, source: "web" as const }));
  } catch {
    return [];
  }
}

async function inferFromKnowledge(
  company: string,
  userId: string
): Promise<{ name: string; title: string; linkedin_url: string | null; source_url: string; source: "ai" }[]> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Tu es un assistant commercial. Tu utilises ta connaissance générale pour identifier les décideurs probables dans une entreprise, utile pour la prospection B2B en coaching.`,
    messages: [{
      role: "user",
      content: `Entreprise : ${company}

Tavily n'est pas disponible. En te basant sur ta connaissance de cette entreprise (ou d'entreprises similaires dans ce secteur), liste les décideurs RH, L&D, direction que tu connais ou qui sont probables.

Si tu ne connais pas cette entreprise précisément, propose les profils types à cibler (ex: "DRH", "Chief People Officer", "Directeur Général") sans inventer de noms.

RÈGLE : Si tu n'as aucune connaissance sur cette entreprise, retourne uniquement les titres de postes sans noms.

Réponds UNIQUEMENT en JSON :
{ "contacts": [ { "name": "Prénom Nom ou null si inconnu", "title": "Poste", "linkedin_url": null, "source_url": null, "note": "connaissance IA" } ] }`,
    }],
  });

  logUsage(userId, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "market_contacts");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.contacts ?? [])
      .filter((c: { name: string }) => c.name && c.name !== "null")
      .map((c: { name: string; title: string; linkedin_url: string | null; source_url: string | null }) => ({ ...c, source: "ai" as const, source_url: c.source_url ?? "" }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const company = req.nextUrl.searchParams.get("company")?.trim();
    if (!company) return NextResponse.json({ contacts: [] });

    // 1. Try Tavily
    const searches = [
      `${company} directeur responsable RH ressources humaines`,
      `${company} CEO DG directeur général équipe dirigeante`,
      `${company} CPO Chief People Officer Head of People`,
    ];

    const allResultsNested = await Promise.all(searches.map((q) => searchTavily(q)));
    const allResults = allResultsNested.flat();

    const seen = new Set<string>();
    const uniqueResults = allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // 2. If Tavily returned results → extract contacts from sources
    if (uniqueResults.length > 0) {
      const sourcesText = uniqueResults
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 400)}`)
        .join("\n\n---\n\n");
      const contacts = await extractFromSources(company, sourcesText, user.id);
      return NextResponse.json({ contacts, fallback: false });
    }

    // 3. Tavily empty → fall back to Claude knowledge
    const contacts = await inferFromKnowledge(company, user.id);
    return NextResponse.json({ contacts, fallback: true });

  } catch (e) {
    console.error("contacts-web error:", e);
    return NextResponse.json({ contacts: [], fallback: false });
  }
}
