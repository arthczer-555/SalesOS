import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { createCompanyContextCache } from "@/lib/prospect-enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 5;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  // Verify campaign ownership and get campaign data
  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });

  // Optional: only regenerate errors
  const body = await req.json().catch(() => ({}));
  const onlyErrors: boolean = body.onlyErrors ?? false;

  // Get pending/error emails
  const statusFilter = onlyErrors ? ["error"] : ["pending", "error"];
  const { data: emails } = await db
    .from("mass_campaign_emails")
    .select("*")
    .eq("campaign_id", id)
    .in("status", statusFilter);

  if (!emails?.length) return NextResponse.json({ generated: 0, errors: 0, total: 0 });

  // Set campaign status to generating
  await db.from("mass_campaigns").update({ status: "generating", updated_at: new Date().toISOString() }).eq("id", id);

  // Fetch user's prospection guide
  const [{ data: userData }, { data: globalModelEntry }, { data: globalGuideEntry }] = await Promise.all([
    db.from("users").select("prospection_guide, name").eq("id", user.id).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
    db.from("guide_defaults").select("content").eq("key", "prospection").single(),
  ]);

  const guide = userData?.prospection_guide ?? globalGuideEntry?.content ?? DEFAULT_PROSPECTION_GUIDE;
  let prospectionModel = "claude-haiku-4-5-20251001";
  try {
    if (globalModelEntry?.content) {
      prospectionModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).mass_prospection ?? prospectionModel;
    }
  } catch { /* keep default */ }

  const senderName = userData?.name?.trim() || user.name?.trim() || "L'équipe Coachello";

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges des emails de prospection ultra-personnalisés, humains et percutants.",
    "L'email doit sonner vrai, pas comme un template générique.",
    "Mobilise ta connaissance générale de l'entreprise du prospect (secteur, taille, actualités, enjeux RH connus) pour ancrer l'accroche. Si un bloc CONTEXTE ENTREPRISE est fourni, priorise ces informations récentes. Reste factuel : n'invente jamais un fait, un chiffre ou un nom.",
    "Varie les accroches d'un prospect à l'autre : si deux prospects se ressemblent, change l'angle (secteur, actualité, douleur).",
    `L'email doit être signé par : ${senderName}. Termine toujours l'email par une signature avec ce nom.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION (exemples et instructions) :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const getCompanyContext = createCompanyContextCache();
  const client = new Anthropic();
  let generated = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (email: Record<string, string>) => {
      try {
        // Mark as generating
        await db.from("mass_campaign_emails").update({ status: "generating" }).eq("id", email.id);

        const extra = (typeof email.extra_data === "object" && email.extra_data) ? email.extra_data as Record<string, string> : {};

        const companyContext = email.company ? await getCompanyContext(email.company) : "";

        const prospectBlock = [
          `Nom : ${email.first_name} ${email.last_name}`,
          `Email : ${email.email}`,
          `Poste : ${email.job_title || "—"}`,
          `Entreprise : ${email.company || "—"}`,
          `Secteur : ${email.industry || "—"}`,
          extra.lifecyclestage ? `Statut CRM : ${extra.lifecyclestage}` : null,
          extra.crmSummary ? `Historique CRM :\n${extra.crmSummary}` : null,
          campaign.qcm_type ? `Type de message : ${campaign.qcm_type === "intro" ? "Premier contact (intro)" : "Follow-up / relance"}` : null,
          campaign.qcm_length ? `Longueur souhaitée : ${campaign.qcm_length}` : null,
          campaign.qcm_tone ? `Ton : ${campaign.qcm_tone}` : null,
          campaign.qcm_objectif ? `Objectif : ${{ rdv: "Obtenir un RDV", ressource: "Partager une ressource", qualifier: "Qualifier le besoin", reactiver: "Réactiver la relation" }[campaign.qcm_objectif as string] ?? campaign.qcm_objectif}` : null,
        ].filter(Boolean).join("\n\n");

        const userPrompt = [
          `OBJECTIF DE LA CAMPAGNE :\n${campaign.objective}`,
          `\nINFORMATIONS SUR LE PROSPECT :\n${prospectBlock}`,
          companyContext ? `\nCONTEXTE ENTREPRISE (sources web récentes, à utiliser en priorité si pertinent) :\n${companyContext}` : "",
          "\nRédige un email de prospection personnalisé pour cette personne.",
        ].filter(Boolean).join("\n");

        const message = await client.messages.create({
          model: prospectionModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });

        logUsage(user.id, prospectionModel, message.usage.input_tokens, message.usage.output_tokens, "mass_prospection_generate");

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

        await db.from("mass_campaign_emails").update({
          subject,
          body,
          status: "drafted",
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", email.id);

        generated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        await db.from("mass_campaign_emails").update({
          status: "error",
          error_message: msg,
          updated_at: new Date().toISOString(),
        }).eq("id", email.id);
        errors++;
      }
    }));
  }

  // Update campaign status
  await db.from("mass_campaigns").update({
    status: "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  return NextResponse.json({ generated, errors, total: emails.length });
}
