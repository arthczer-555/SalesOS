import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import {
  fetchCompanyLinkedInContext,
  fetchCompanyWebContext,
  fetchLinkedInContext,
} from "@/lib/prospect-enrichment";
import type { DraftProvenance } from "@/lib/prospection/provenance";

export const dynamic = "force-dynamic";

interface ContactInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  jobTitle?: string;
  company?: string;
  industry?: string;
  lifecyclestage?: string;
  crmSummary?: string;
  linkedinUrl?: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { contactInfo, recentNews, companyContext, coachingNeed, angle, userInstructions, qcmType, qcmLength, qcmTone, qcmObjectif } = await req.json() as {
    contactInfo: ContactInfo;
    recentNews?: string;
    companyContext?: string;
    coachingNeed?: string;
    angle?: string;
    userInstructions?: string;
    qcmType?: string;
    qcmLength?: string;
    qcmTone?: string;
    qcmObjectif?: string;
  };

  const [{ data }, { data: globalModelEntry }, { data: globalGuideEntry }] = await Promise.all([
    db.from("users").select("prospection_guide").eq("id", user.id).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
    db.from("guide_defaults").select("content").eq("key", "prospection").single(),
  ]);
  const guide = data?.prospection_guide ?? globalGuideEntry?.content ?? DEFAULT_PROSPECTION_GUIDE;
  let prospectionModel = "claude-haiku-4-5-20251001";
  try { if (globalModelEntry?.content) prospectionModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).prospection ?? prospectionModel; } catch { /* keep default */ }

  const senderName = user.name?.trim() || "L'équipe Coachello";

  // ── Enrichissement (best-effort, parallèle) ──────────────────────────────
  // 1) Profil LinkedIn du prospect (Bright Data)
  // 2) Recherche web entreprise (Tavily, dernières actus / actualité RH)
  // Le LinkedIn entreprise dépend du profil (on récupère le slug exact depuis
  // la position courante), donc il est lancé séquentiellement après.
  const [linkedin, companyWeb] = await Promise.all([
    fetchLinkedInContext({
      firstName: contactInfo.firstName,
      lastName: contactInfo.lastName,
      email: contactInfo.email,
      company: contactInfo.company,
      linkedinUrl: contactInfo.linkedinUrl ?? null,
    }),
    contactInfo.company ? fetchCompanyWebContext(contactInfo.company) : Promise.resolve({ text: "", sources: [] }),
  ]);
  const companyLinkedIn = contactInfo.company
    ? await fetchCompanyLinkedInContext(contactInfo.company, linkedin.currentCompanyUsername)
    : "";

  const fullName = [contactInfo.firstName, contactInfo.lastName].filter(Boolean).join(" ").trim();
  const prospectBlock = [
    fullName ? `Nom : ${fullName}` : null,
    contactInfo.email ? `Email : ${contactInfo.email}` : null,
    contactInfo.jobTitle ? `Poste : ${contactInfo.jobTitle}` : null,
    contactInfo.company ? `Entreprise : ${contactInfo.company}` : null,
    contactInfo.industry ? `Secteur : ${contactInfo.industry}` : null,
    contactInfo.lifecyclestage ? `Statut CRM : ${contactInfo.lifecyclestage}` : null,
    contactInfo.crmSummary ? `Historique CRM :\n${contactInfo.crmSummary}` : null,
    recentNews ? `Actualité récente / contexte externe :\n${recentNews}` : null,
    companyContext ? `Contexte de l'entreprise :\n${companyContext}` : null,
    coachingNeed ? `Pourquoi pourrait-il avoir besoin de coaching :\n${coachingNeed}` : null,
    angle ? `Angle d'attaque / message clé :\n${angle}` : null,
    qcmType ? `Type de message : ${qcmType === "intro" ? "Premier contact (intro)" : "Follow-up / relance"}` : null,
    qcmLength ? `Longueur souhaitée : ${qcmLength}` : null,
    qcmTone ? `Ton : ${qcmTone}` : null,
    qcmObjectif ? `Objectif : ${{ rdv: "Obtenir un RDV", ressource: "Partager une ressource", qualifier: "Qualifier le besoin", reactiver: "Réactiver la relation" }[qcmObjectif] ?? qcmObjectif}` : null,
    userInstructions ? `Instructions spécifiques de l'utilisateur :\n${userInstructions}` : null,
  ].filter(Boolean).join("\n\n");

  const linkedinEnriched = Boolean(linkedin.text);

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges des emails de prospection ultra-personnalisés, humains et percutants.",
    "L'email doit sonner vrai, pas comme un template générique.",
    "LANGUE : détecte la langue dominante des INSTRUCTIONS UTILISATEUR (si présentes). Sinon, repli sur la langue de l'angle/contexte fourni. Sinon, français. Rédige le subject ET le body dans cette langue (idiomes, ponctuation, signature inclus). Si les instructions sont en anglais, l'email est en anglais ; en espagnol, en espagnol ; etc.",
    "Mobilise ta connaissance générale de l'entreprise du prospect (secteur, taille, actualités, enjeux RH connus) pour ancrer l'accroche. Si des blocs CONTEXTE ENTREPRISE ou FICHE LINKEDIN ENTREPRISE sont fournis, priorise ces informations. Reste factuel : n'invente jamais un fait, un chiffre ou un nom.",
    linkedinEnriched
      ? "Un profil LinkedIn enrichi est disponible : utilise-le pour personnaliser (mentionne 1 élément précis du parcours, d'une compétence ou d'une expérience pertinente, pas de namedropping forcé)."
      : "",
    `L'email doit être signé par : ${senderName}. Termine toujours l'email par une signature avec ce nom.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION (exemples et instructions) :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = [
    `Voici les informations sur le prospect :\n\n${prospectBlock}`,
    linkedin.text ? `\nPROFIL LINKEDIN ENRICHI (utilise-le pour personnaliser : 1 élément précis du parcours, d'une compétence ou d'une expérience pertinente — pas de namedropping forcé) :\n${linkedin.text}` : "",
    companyLinkedIn ? `\nFICHE LINKEDIN ENTREPRISE :\n${companyLinkedIn}` : "",
    companyWeb.text ? `\nCONTEXTE ENTREPRISE (sources web récentes, à utiliser en priorité si pertinent) :\n${companyWeb.text}` : "",
    "\nRédige un email de prospection personnalisé pour cette personne.",
  ].filter(Boolean).join("\n");

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

  const provenance: DraftProvenance = {
    linkedinProfile: linkedinEnriched,
    companyLinkedin: Boolean(companyLinkedIn),
    webSources: companyWeb.sources,
    contexts: [
      contactInfo.crmSummary ? "CRM history" : null,
      recentNews ? "Provided context/news" : null,
      companyContext ? "Company context" : null,
      coachingNeed ? "Coaching angle" : null,
      "Prospection guide",
      userInstructions ? "Your instructions" : null,
    ].filter((c): c is string => Boolean(c)),
  };

  return NextResponse.json({ subject, body, linkedinEnriched, provenance });
}
