import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

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

  // Fetch existing signals for context
  const { data: signals } = await db
    .from("competitive_signals")
    .select("type, title, summary, signal_date")
    .eq("competitor_id", competitorId)
    .order("signal_date", { ascending: false })
    .limit(10);

  const signalContext = (signals ?? []).map((s: { type: string; signal_date: string; title: string; summary: string }) =>
    `[${s.type.toUpperCase()}] ${s.signal_date ?? ""} — ${s.title}: ${s.summary}`
  ).join("\n");

  const systemPrompt = `Tu es un expert en stratégie commerciale pour Coachello, spécialiste du coaching professionnel B2B (coaching individuel et collectif pour cadres/managers, offre IA + offre humaine).
Tu génères des battlecards de vente précises et actionnables, utilisées par les commerciaux Coachello lors de deals où le prospect compare avec des concurrents.`;

  const userPrompt = `Génère une battlecard de vente pour le concurrent suivant :

Nom : ${competitor.name}
Site : ${competitor.website ?? "non renseigné"}
Catégorie : ${competitor.category}
Description : ${competitor.description ?? "non renseignée"}

${signalContext ? `Signaux récents observés :\n${signalContext}\n` : ""}

La battlecard doit contenir ces 7 sections en Markdown :

## Positionnement
1-2 phrases résumant qui ils sont et comment ils se positionnent sur le marché du coaching B2B.

## Clients cibles typiques
Qui achète chez eux ? Taille d'entreprise, secteur, profil décisionnaire.

## Leurs forces (vs Coachello)
Ce qu'ils font mieux que nous ou que les prospects leur reconnaissent.

## Leurs faiblesses exploitables
Points faibles concrets que Coachello peut exploiter en situation de vente.

## Modèle commercial & pricing
Comment ils vendent (abonnement, à la séance, forfait entreprise…) et estimation de prix si connue.

## Objections et réponses
3 objections typiques qu'un prospect peut avoir face à Coachello en comparant avec ce concurrent, avec la réponse commerciale recommandée. Format : **Objection :** … / **Réponse :** …

## Notre message différenciateur
1 phrase percutante que le commercial peut utiliser pour se démarquer de ce concurrent dans un pitch.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);

  const content = message.content[0].type === "text" ? message.content[0].text : "";

  // Store in competitors table
  await db.from("competitors").update({ battlecard: content }).eq("id", competitorId);

  return NextResponse.json({ battlecard: content });
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const competitorId = searchParams.get("competitorId");
  if (!competitorId) return NextResponse.json({ error: "competitorId manquant" }, { status: 400 });

  const { data, error } = await db
    .from("competitors")
    .select("battlecard")
    .eq("id", competitorId)
    .eq("user_id", user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ battlecard: data?.battlecard ?? null });
}
