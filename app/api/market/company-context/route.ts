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
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, days: 90 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

async function searchHubSpot(company: string): Promise<{ dealName: string; stage: string } | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: company }] }],
        properties: ["dealname", "dealstage"],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const deal = data.results?.[0];
    if (!deal) return null;
    return { dealName: deal.properties.dealname, stage: deal.properties.dealstage };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const { company } = await req.json();
    if (!company?.trim()) return NextResponse.json({ error: "company manquant" }, { status: 400 });

    const [webResults, deal] = await Promise.all([
      searchTavily(`${company} présentation activité taille équipe RH coaching`),
      searchHubSpot(company),
    ]);

    const sourcesText = webResults.length > 0
      ? webResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join("\n\n---\n\n")
      : "Aucune information trouvée.";

    const hubspotContext = deal ? `Deal HubSpot existant : "${deal.dealName}" (stage: ${deal.stage})` : "Aucun deal HubSpot trouvé.";

    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: "Tu es un analyste commercial. À partir de sources web, génère une fiche contexte concise sur une entreprise, utile pour un commercial en coaching B2B.",
      messages: [{
        role: "user",
        content: `Entreprise : ${company}
${hubspotContext}

Sources web :
${sourcesText}

Génère une fiche contexte avec :
- description: 1 phrase de présentation (secteur, taille approx, stade)
- keyFacts: 3 à 5 faits clés pertinents pour un commercial coaching (RH, leadership, croissance, défis)
- hubspotDeal: le nom du deal HubSpot si présent, sinon null

Réponds UNIQUEMENT en JSON :
{ "description": "...", "keyFacts": ["...", "..."], "hubspotDeal": null }`,
      }],
    });

    logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ description: company, keyFacts: [], hubspotDeal: null });

    try {
      return NextResponse.json(JSON.parse(jsonMatch[0]));
    } catch {
      return NextResponse.json({ description: company, keyFacts: [], hubspotDeal: null });
    }
  } catch (e) {
    console.error("company-context error:", e);
    return NextResponse.json({ description: "", keyFacts: [], hubspotDeal: null });
  }
}
