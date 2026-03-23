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

export async function analyzeOneCompetitor(competitor: Competitor, userId: string | null) {
  const monitoredTypes: string[] = [];
  if (competitor.monitor_products) monitoredTypes.push("lancement de produits / nouvelles fonctionnalités");
  if (competitor.monitor_funding) monitoredTypes.push("levées de fonds / acquisitions / partenariats stratégiques");
  if (competitor.monitor_hiring) monitoredTypes.push("recrutements clés / réorganisations internes");
  if (competitor.monitor_content) monitoredTypes.push("publications de contenu stratégique / positionnement marché");
  if (competitor.monitor_pricing) monitoredTypes.push("changements de pricing / nouvelles offres");

  const systemPrompt = `Tu es un analyste en veille concurrentielle senior pour Coachello, société spécialisée dans le coaching professionnel B2B en France et en Europe.
Coachello propose des programmes de coaching individuel et collectif pour cadres et managers, avec une offre IA (AI Coaching) et une offre coaching humain (Human Coaching).

Ton rôle : générer des signaux de veille pertinents sur un concurrent donné, basés sur ta connaissance de ce marché.
Sois factuel, précis, et oriente les signaux vers ce qui est stratégiquement utile pour Coachello.`;

  const userPrompt = `Concurrent à analyser :
- Nom : ${competitor.name}
- Site : ${competitor.website ?? "non renseigné"}
- Catégorie : ${competitor.category}
- Description : ${competitor.description ?? "non renseignée"}
- Types de signaux à surveiller : ${monitoredTypes.join(", ")}

Génère 6 à 8 signaux de veille récents et pertinents sur ce concurrent (période 2023–2025).

Pour chaque signal, retourne un objet avec ces champs :
- type: une valeur parmi 'product' | 'funding' | 'hiring' | 'content' | 'pricing'
- title: titre court et percutant (< 80 caractères)
- summary: résumé factuel de 2 à 3 phrases avec des détails concrets
- signal_date: date estimée au format "YYYY-MM" (ex: "2024-11")
- confidence: 'high' si fait avéré et documenté, 'medium' si probable, 'low' si incertain
- linkedin_suggestion: null, ou une suggestion concrète d'action LinkedIn (ex: "Rechercher les nouveaux responsables produit recrutés en 2024 sur leur page LinkedIn")

Réponds UNIQUEMENT en JSON valide :
{ "signals": [ { "type": "...", "title": "...", "summary": "...", "signal_date": "...", "confidence": "...", "linkedin_suggestion": null } ] }`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
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
    linkedin_suggestion: string | null;
  }[] = parsed.signals ?? [];

  // Delete old signals for this competitor, then insert fresh ones
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
