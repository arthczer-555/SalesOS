import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
  crmSummary: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { contactInfo, recentNews, companyContext, coachingNeed, angle, userInstructions } = await req.json() as {
    contactInfo: ContactInfo;
    recentNews?: string;
    companyContext?: string;
    coachingNeed?: string;
    angle?: string;
    userInstructions?: string;
  };

  // Fetch the user's personal prospection guide from DB
  const [{ data }, { data: globalModelEntry }] = await Promise.all([
    db.from("users").select("prospection_guide").eq("id", user.id).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
  ]);
  const guide = data?.prospection_guide ?? "";
  let prospectionModel = "claude-haiku-4-5-20251001";
  try { if (globalModelEntry?.content) prospectionModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).prospection ?? prospectionModel; } catch { /* keep default */ }

  const prospectBlock = [
    `Nom : ${contactInfo.firstName} ${contactInfo.lastName}`,
    `Email : ${contactInfo.email}`,
    `Poste : ${contactInfo.jobTitle || "—"}`,
    `Entreprise : ${contactInfo.company || "—"}`,
    `Secteur : ${contactInfo.industry || "—"}`,
    `Statut CRM : ${contactInfo.lifecyclestage || "—"}`,
    contactInfo.crmSummary ? `Historique CRM :\n${contactInfo.crmSummary}` : null,
    recentNews ? `Actualité récente / contexte externe :\n${recentNews}` : null,
    companyContext ? `Contexte de l'entreprise :\n${companyContext}` : null,
    coachingNeed ? `Pourquoi pourrait-il avoir besoin de coaching :\n${coachingNeed}` : null,
    angle ? `Angle d'attaque / message clé :\n${angle}` : null,
    userInstructions ? `Instructions spécifiques de l'utilisateur :\n${userInstructions}` : null,
  ].filter(Boolean).join("\n\n");

  const senderName = user.name?.trim() || "L'équipe Coachello";

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges des emails de prospection ultra-personnalisés, humains et percutants.",
    "L'email doit sonner vrai, pas comme un template générique.",
    `L'email doit être signé par : ${senderName}. Termine toujours l'email par une signature avec ce nom.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION (exemples et instructions) :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = `Voici les informations sur le prospect :\n\n${prospectBlock}\n\nRédige un email de prospection personnalisé pour cette personne.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: prospectionModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, prospectionModel, message.usage.input_tokens, message.usage.output_tokens, "prospection_generate");
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
