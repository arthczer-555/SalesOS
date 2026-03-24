import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

type Competitor = {
  id: string;
  user_id: string;
  name: string;
  website: string | null;
  category: string;
  description: string | null;
  monitor_hiring: boolean;
  monitor_products: boolean;
  monitor_funding: boolean;
  monitor_content: boolean;
  monitor_pricing: boolean;
};

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

async function searchTavily(query: string): Promise<TavilyResult[]> {
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
        days: 7,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

export async function analyzeOneCompetitor(competitor: Competitor, userId: string | null) {
  // ─── 1. Build search queries based on monitored types ───────────────────────
  const searches: string[] = [`${competitor.name} actualités`];
  if (competitor.monitor_products) searches.push(`${competitor.name} nouveau produit fonctionnalité lancement`);
  if (competitor.monitor_funding) searches.push(`${competitor.name} levée de fonds acquisition partenariat`);
  if (competitor.monitor_hiring) searches.push(`${competitor.name} recrutement nomination dirigeant`);
  if (competitor.monitor_content) searches.push(`${competitor.name} étude rapport positionnement`);
  if (competitor.monitor_pricing) searches.push(`${competitor.name} pricing tarif offre`);

  // ─── 2. Run searches in parallel ────────────────────────────────────────────
  const allResultsNested = await Promise.all(searches.map((q) => searchTavily(q)));
  const allResults = allResultsNested.flat();

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // ─── 3. Build Claude prompt ──────────────────────────────────────────────────
  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const systemPrompt = `Tu es un analyste en veille concurrentielle senior pour Coachello, société spécialisée dans le coaching professionnel B2B en France et en Europe.
Coachello propose des programmes de coaching individuel et collectif pour cadres et managers, avec une offre IA (AI Coaching) et une offre coaching humain (Human Coaching).

Ton rôle : analyser des résultats de recherche web récents sur un concurrent et en extraire des signaux stratégiquement utiles pour Coachello.
Reste factuel : n'invente rien, base-toi uniquement sur les sources fournies.
Si les sources ne contiennent rien de notable, génère 1 signal de fond honnête (confidence: "low").`;

  const sourcesText = uniqueResults.length > 0
    ? uniqueResults.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}${r.published_date ? `\nDate: ${r.published_date}` : ""}\n${r.content}`
      ).join("\n\n---\n\n")
    : "Aucun résultat de recherche disponible pour cette semaine.";

  const monitoredTypes: string[] = [];
  if (competitor.monitor_products) monitoredTypes.push("lancement de produits / nouvelles fonctionnalités");
  if (competitor.monitor_funding) monitoredTypes.push("levées de fonds / acquisitions / partenariats stratégiques");
  if (competitor.monitor_hiring) monitoredTypes.push("recrutements clés / réorganisations internes");
  if (competitor.monitor_content) monitoredTypes.push("publications de contenu stratégique / positionnement marché");
  if (competitor.monitor_pricing) monitoredTypes.push("changements de pricing / nouvelles offres");

  const userPrompt = `Nous sommes le ${today}. Analyse la semaine écoulée (du ${weekAgo} au ${today}).

Concurrent : ${competitor.name}
Site : ${competitor.website ?? "non renseigné"}
Catégorie : ${competitor.category}
Description : ${competitor.description ?? "non renseignée"}
Types à surveiller : ${monitoredTypes.join(", ") || "tous"}

Résultats de recherche web récents :
${sourcesText}

RÈGLES STRICTES :
1. Ne génère un signal QUE si une source contient un fait précis, daté, et spécifique à cette semaine (annonce, lancement, recrutement, publication, levée de fonds, changement de prix…).
2. Les articles génériques (présentation de l'entreprise, page À propos, résultats Google vagues) NE sont PAS des signaux.
3. S'il n'y a aucun fait réel cette semaine → retourne "signals": [] (tableau vide).
4. Ne duplique pas : si deux sources parlent du même événement, c'est un seul signal.
5. Ne fabrique jamais d'informations absentes des sources.

Pour chaque signal valide :
- type: 'product' | 'funding' | 'hiring' | 'content' | 'pricing'
- title: titre court et précis (< 80 caractères), cite un fait concret
- summary: 2-3 phrases factuelles avec les détails clés (chiffres, noms, dates si dispo)
- signal_date: format "YYYY-MM" si connue dans la source, sinon mois en cours
- confidence: 'high' si fait avéré dans la source, 'medium' si probable, 'low' si incertain
- source_url: URL exacte de la source ou null
- linkedin_suggestion: action LinkedIn concrète si pertinente, sinon null

Réponds UNIQUEMENT en JSON valide :
{ "signals": [ { "type": "...", "title": "...", "summary": "...", "signal_date": "...", "confidence": "...", "source_url": null, "linkedin_suggestion": null } ] }`;

  // ─── 4. Call Claude ──────────────────────────────────────────────────────────
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(userId, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Réponse IA invalide");

  const parsed = JSON.parse(jsonMatch[0]);
  const signals: {
    type: string;
    title: string;
    summary: string;
    signal_date: string;
    confidence: string;
    source_url: string | null;
    linkedin_suggestion: string | null;
  }[] = parsed.signals ?? [];

  // ─── 5. Store in Supabase ────────────────────────────────────────────────────
  await db.from("competitive_signals").delete().eq("competitor_id", competitor.id);

  if (signals.length > 0) {
    await db.from("competitive_signals").insert(
      signals.map((s) => ({
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        type: s.type,
        title: s.title,
        summary: s.summary,
        signal_date: s.signal_date ?? null,
        source_url: s.source_url ?? null,
        linkedin_suggestion: s.linkedin_suggestion ?? null,
        confidence: s.confidence ?? "medium",
      }))
    );
  }

  return signals.length;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { competitorId } = await req.json();
  if (!competitorId) return NextResponse.json({ error: "competitorId manquant" }, { status: 400 });

  const { data: competitor, error } = await db
    .from("competitors")
    .select("*")
    .eq("id", competitorId)
    .eq("user_id", user.id)
    .single();

  if (error || !competitor) return NextResponse.json({ error: "Concurrent introuvable" }, { status: 404 });

  try {
    const count = await analyzeOneCompetitor(competitor as Competitor, user.id);
    return NextResponse.json({ signals: count });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
