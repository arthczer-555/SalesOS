import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Fetch all competitors + their signals
  const { data: competitors } = await db
    .from("competitors")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (!competitors || competitors.length === 0) {
    return NextResponse.json({ error: "Aucun concurrent configuré" }, { status: 400 });
  }

  const competitorIds = competitors.map((c: { id: string }) => c.id);

  const { data: signals } = await db
    .from("competitive_signals")
    .select("*")
    .in("competitor_id", competitorIds)
    .order("signal_date", { ascending: false });

  // Build context
  const context = competitors.map((c: {
    id: string;
    name: string;
    website: string | null;
    category: string;
    description: string | null;
  }) => {
    const cSignals = (signals ?? []).filter((s: { competitor_id: string }) => s.competitor_id === c.id);
    const signalLines = cSignals.map((s: { type: string; signal_date: string; title: string; summary: string }) =>
      `  - [${s.type.toUpperCase()}] ${s.signal_date ?? ""} — ${s.title}: ${s.summary}`
    ).join("\n");
    return `### ${c.name} (${c.category})\nSite : ${c.website ?? "N/A"}\n${c.description ? `Description : ${c.description}\n` : ""}Signaux récents :\n${signalLines || "  Aucun signal enregistré"}`;
  }).join("\n\n");

  const systemPrompt = `Tu es un analyste stratégique senior pour Coachello, leader du coaching professionnel B2B en France.
Coachello propose du coaching individuel et collectif pour cadres et managers, avec une dimension IA.
Tu dois rédiger des rapports de veille actionnables, orientés décision commerciale et stratégique.`;

  const userPrompt = `Voici les concurrents surveillés et leurs signaux récents :

${context}

Génère un rapport de veille concurrentielle complet en Markdown avec les sections suivantes :

## Synthèse exécutive
3 à 4 phrases résumant les mouvements clés et leur impact pour Coachello.

## Faits marquants par concurrent
Pour chaque concurrent, 2 à 4 bullet points sur leurs actions les plus significatives.

## Tendances du marché coaching B2B
3 à 5 tendances émergentes observées à travers ces signaux.

## Recommandations stratégiques pour Coachello
3 à 5 recommandations concrètes et actionnables basées sur l'analyse.

Sois précis, factuel et orienté impact business. Évite les généralités.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "competitive_report");

  const content = message.content[0].type === "text" ? message.content[0].text : "";

  // Save report
  await db.from("competitive_reports").insert({
    content,
    competitor_ids: competitorIds,
  });

  // Return latest report
  const { data: latest } = await db
    .from("competitive_reports")
    .select("id, content, generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json(latest);
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data } = await db
    .from("competitive_reports")
    .select("id, content, generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(data ?? null);
}
