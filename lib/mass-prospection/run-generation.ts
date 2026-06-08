/**
 * Génération d'emails de campagne mass-prospection.
 *
 * Extrait de la route POST .../generate pour pouvoir tourner dans une Netlify
 * Background Function : l'enrichissement LinkedIn (fetchLinkedInContext) scrape
 * chaque prospect via Bright Data (10-60s/profil), ce qui dépasse la limite
 * synchrone Netlify quand il y a 10+ prospects. Le front poll le statut de la
 * campagne pendant ce temps.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import {
  createCompanyContextCache,
  createCompanyLinkedInCache,
  fetchLinkedInContext,
} from "@/lib/prospect-enrichment";
import type { DraftProvenance } from "@/lib/prospection/provenance";

const BATCH_SIZE = 5;

export async function runCampaignGeneration(
  campaignId: string,
  userId: string,
  opts: { onlyErrors?: boolean } = {},
): Promise<{ generated: number; errors: number; total: number }> {
  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single();
  if (!campaign) return { generated: 0, errors: 0, total: 0 };

  const statusFilter = opts.onlyErrors ? ["error"] : ["pending", "error"];
  const { data: emails } = await db
    .from("mass_campaign_emails")
    .select("*")
    .eq("campaign_id", campaignId)
    .in("status", statusFilter);

  if (!emails?.length) {
    await db.from("mass_campaigns").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", campaignId);
    return { generated: 0, errors: 0, total: 0 };
  }

  await db.from("mass_campaigns").update({ status: "generating", updated_at: new Date().toISOString() }).eq("id", campaignId);

  const [{ data: userData }, { data: globalModelEntry }, { data: globalGuideEntry }] = await Promise.all([
    db.from("users").select("prospection_guide, name").eq("id", userId).maybeSingle(),
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

  const senderName = userData?.name?.trim() || "L'équipe Coachello";

  const systemPrompt = [
    "Tu es un expert en prospection B2B pour Coachello, une entreprise de coaching professionnel.",
    "Tu rédiges des emails de prospection ultra-personnalisés, humains et percutants.",
    "L'email doit sonner vrai, pas comme un template générique.",
    "LANGUE : détecte la langue dominante à partir, dans l'ordre, de l'OBJECTIF DE LA CAMPAGNE, puis du CONTEXTE ENTREPRISE / FICHE LINKEDIN, puis du Poste du prospect. Sinon, repli sur le français. Rédige TOUT (subject, body, signature) dans cette langue. Si la source est en anglais, écris en anglais ; en espagnol, en espagnol ; etc.",
    "Mobilise ta connaissance générale de l'entreprise du prospect (secteur, taille, actualités, enjeux RH connus) pour ancrer l'accroche. Si des blocs CONTEXTE ENTREPRISE ou FICHE LINKEDIN ENTREPRISE sont fournis, priorise ces informations. Reste factuel : n'invente jamais un fait, un chiffre ou un nom.",
    "Varie les accroches d'un prospect à l'autre : si deux prospects se ressemblent, change l'angle (secteur, actualité, douleur).",
    `L'email doit être signé par : ${senderName}. Termine toujours l'email par une signature avec ce nom.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION (exemples et instructions) :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  // On tourne dans une Background Function (jusqu'à 15min) → timeouts de scrape
  // généreux pour maximiser le taux d'enrichissement LinkedIn.
  const getCompanyContext = createCompanyContextCache();
  const getCompanyLinkedIn = createCompanyLinkedInCache(60_000);
  const client = new Anthropic();
  let generated = 0;
  let errors = 0;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (email: Record<string, string>) => {
      try {
        await db.from("mass_campaign_emails").update({ status: "generating" }).eq("id", email.id);

        const extra = (typeof email.extra_data === "object" && email.extra_data) ? email.extra_data as Record<string, string> : {};
        const extraRaw = (typeof email.extra_data === "object" && email.extra_data) ? email.extra_data as Record<string, unknown> : {};
        const previousEmail = (extraRaw.previous_email && typeof extraRaw.previous_email === "object")
          ? extraRaw.previous_email as { subject?: string; body?: string; sent_at?: string }
          : null;

        const [companyContext, linkedin] = await Promise.all([
          email.company ? getCompanyContext(email.company) : Promise.resolve({ text: "", sources: [] }),
          fetchLinkedInContext({
            firstName: email.first_name,
            lastName: email.last_name,
            email: email.email,
            company: email.company,
            linkedinUrl: extra.linkedinUrl ?? null,
          }, { profileTimeoutMs: 75_000 }),
        ]);
        const companyLinkedIn = email.company
          ? await getCompanyLinkedIn(email.company, linkedin.currentCompanyUsername)
          : "";

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
          previousEmail?.body
            ? `EMAIL PRÉCÉDENT DÉJÀ ENVOYÉ À CE PROSPECT${previousEmail.sent_at ? ` (le ${new Date(previousEmail.sent_at).toLocaleDateString("fr-FR")})` : ""} :\nObjet : ${previousEmail.subject ?? "(sans objet)"}\n${previousEmail.body}`
            : null,
        ].filter(Boolean).join("\n\n");

        const userPrompt = [
          `OBJECTIF DE LA CAMPAGNE :\n${campaign.objective}`,
          `\nINFORMATIONS SUR LE PROSPECT :\n${prospectBlock}`,
          previousEmail?.body
            ? "\nC'est une RELANCE. Écris un follow-up court qui s'appuie sur l'email précédent (rappelle brièvement le contexte sans le copier-coller), apporte un nouvel angle ou une nouvelle raison de répondre, et reste poli sans culpabiliser le prospect."
            : "",
          linkedin.text ? `\nPROFIL LINKEDIN ENRICHI (utilise-le pour personnaliser : 1 élément précis du parcours, d'une compétence ou d'une expérience pertinente — pas de namedropping forcé) :\n${linkedin.text}` : "",
          companyLinkedIn ? `\nFICHE LINKEDIN ENTREPRISE :\n${companyLinkedIn}` : "",
          companyContext.text ? `\nCONTEXTE ENTREPRISE (sources web récentes, à utiliser en priorité si pertinent) :\n${companyContext.text}` : "",
          "\nRédige un email de prospection personnalisé pour cette personne.",
        ].filter(Boolean).join("\n");

        const message = await client.messages.create({
          model: prospectionModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });

        logUsage(userId, prospectionModel, message.usage.input_tokens, message.usage.output_tokens, "mass_prospection_generate");

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
          linkedinProfile: Boolean(linkedin.text),
          companyLinkedin: Boolean(companyLinkedIn),
          webSources: companyContext.sources,
          contexts: [
            extra.crmSummary ? "CRM history" : null,
            previousEmail?.body ? "Previous email (follow-up)" : null,
            "Prospection guide",
          ].filter((c): c is string => Boolean(c)),
        };

        await db.from("mass_campaign_emails").update({
          subject,
          body,
          status: "drafted",
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
          extra_data: { ...extraRaw, provenance },
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

  await db.from("mass_campaigns").update({
    status: "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  return { generated, errors, total: emails.length };
}
