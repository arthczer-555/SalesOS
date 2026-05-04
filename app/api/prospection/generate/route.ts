import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { getProfile, resolveUsername, type LinkedInProfile } from "@/lib/netrows";

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

  // Fetch the user's personal prospection guide from DB
  const [{ data }, { data: globalModelEntry }, { data: globalGuideEntry }] = await Promise.all([
    db.from("users").select("prospection_guide").eq("id", user.id).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
    db.from("guide_defaults").select("content").eq("key", "prospection").single(),
  ]);
  const guide = data?.prospection_guide ?? globalGuideEntry?.content ?? DEFAULT_PROSPECTION_GUIDE;
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
    qcmType ? `Type de message : ${qcmType === "intro" ? "Premier contact (intro)" : "Follow-up / relance"}` : null,
    qcmLength ? `Longueur souhaitée : ${qcmLength}` : null,
    qcmTone ? `Ton : ${qcmTone}` : null,
    qcmObjectif ? `Objectif : ${{ rdv: "Obtenir un RDV", ressource: "Partager une ressource", qualifier: "Qualifier le besoin", reactiver: "Réactiver la relation" }[qcmObjectif] ?? qcmObjectif}` : null,
    userInstructions ? `Instructions spécifiques de l'utilisateur :\n${userInstructions}` : null,
  ].filter(Boolean).join("\n\n");

  const senderName = user.name?.trim() || "L'équipe Coachello";

  // ── LinkedIn enrichment via Netrows (best-effort) ─────────────────────────
  let linkedinBlock = "";
  let linkedinEnriched = false;
  if (process.env.NETROWS_API_KEY) {
    try {
      const username = await resolveUsername({
        firstName: contactInfo.firstName,
        lastName: contactInfo.lastName,
        company: contactInfo.company,
        email: contactInfo.email,
      });
      if (username) {
        const profile: LinkedInProfile = await getProfile(username);
        const positions = (profile.position ?? []).slice(0, 5).map((p) => {
          const start = p.start ? `${p.start.month ? p.start.month + "/" : ""}${p.start.year}` : "";
          const end = p.end?.year ? `${p.end.month ? p.end.month + "/" : ""}${p.end.year}` : "présent";
          return `- ${p.title} @ ${p.companyName} (${start} → ${end})${p.description ? `\n  ${p.description.slice(0, 200)}` : ""}`;
        }).join("\n");
        const skills = (profile.skills ?? []).slice(0, 12).map((s) => s.name).join(", ");
        const educations = (profile.educations ?? []).slice(0, 2).map((e) =>
          `${e.degree ?? ""} ${e.fieldOfStudy ?? ""} — ${e.schoolName ?? ""}`.trim()
        ).join(", ");
        linkedinBlock = [
          `Headline LinkedIn : ${profile.headline ?? "—"}`,
          positions ? `Parcours :\n${positions}` : "",
          skills ? `Compétences : ${skills}` : "",
          educations ? `Formation : ${educations}` : "",
          profile.summary ? `Bio LinkedIn :\n${profile.summary.slice(0, 500)}` : "",
        ].filter(Boolean).join("\n");
        linkedinEnriched = true;
      }
    } catch {
      /* enrichment optional */
    }
  }

  const fullProspectBlock = linkedinBlock
    ? `${prospectBlock}\n\nProfil LinkedIn enrichi :\n${linkedinBlock}`
    : prospectBlock;

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges des emails de prospection ultra-personnalisés, humains et percutants.",
    "L'email doit sonner vrai, pas comme un template générique.",
    linkedinEnriched
      ? "Un profil LinkedIn enrichi est disponible : utilise-le pour personnaliser (mentionne 1 élément précis du parcours, d'une compétence ou d'une expérience pertinente — pas de namedropping forcé)."
      : "",
    `L'email doit être signé par : ${senderName}. Termine toujours l'email par une signature avec ce nom.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION (exemples et instructions) :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = `Voici les informations sur le prospect :\n\n${fullProspectBlock}\n\nRédige un email de prospection personnalisé pour cette personne.`;

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

  return NextResponse.json({ subject, body, linkedinEnriched });
}
