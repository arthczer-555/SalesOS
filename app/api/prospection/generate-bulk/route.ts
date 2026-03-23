import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

interface BulkContact {
  firstName: string;
  lastName: string;
  company: string;
  industry: string;
  lifecyclestage: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { contacts, instructions } = await req.json() as {
    contacts: BulkContact[];
    instructions?: string;
  };

  if (!contacts?.length) return NextResponse.json({ error: "Aucun contact" }, { status: 400 });
  if (contacts.length > 100) return NextResponse.json({ error: "Maximum 100 contacts" }, { status: 400 });

  const { data } = await db.from("users").select("prospection_guide").eq("id", user.id).maybeSingle();
  const guide = data?.prospection_guide ?? "";

  // Summarize group characteristics
  const companies = contacts.map((c) => c.company).filter(Boolean);
  const industries = [...new Set(contacts.map((c) => c.industry).filter(Boolean))];
  const stages = [...new Set(contacts.map((c) => c.lifecyclestage).filter(Boolean))];

  const groupBlock = [
    `Nombre de destinataires : ${contacts.length}`,
    companies.length ? `Entreprises : ${companies.slice(0, 10).join(", ")}${companies.length > 10 ? "…" : ""}` : null,
    industries.length ? `Secteurs représentés : ${industries.join(", ")}` : null,
    stages.length ? `Stades CRM : ${stages.join(", ")}` : null,
    instructions ? `Instructions spécifiques :\n${instructions}` : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges un email de prospection de groupe — percutant, humain, adapté au profil commun des destinataires.",
    "IMPORTANT : Le corps de l'email NE doit PAS contenir de formule d'accroche (pas de Hi, Bonjour, Cher...). Commence directement par la première phrase de contenu. Le greeting sera ajouté automatiquement pour chaque destinataire.",
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = `Rédige un email de prospection pour ce groupe de contacts :\n\n${groupBlock}\n\nL'email doit résonner avec ce groupe tout en restant personnel et non générique.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens);
  const raw = message.content[0].type === "text" ? message.content[0].text : "";

  let subject = "";
  let body = "";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      subject = parsed.subject ?? "";
      body = parsed.body ?? "";
    }
  } catch {
    body = raw;
  }

  return NextResponse.json({ subject, body });
}
