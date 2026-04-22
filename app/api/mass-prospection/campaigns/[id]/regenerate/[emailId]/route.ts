import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { fetchCompanyWebContext } from "@/lib/prospect-enrichment";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; emailId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id, emailId } = await params;

  // Verify campaign + get data
  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });

  const { data: email } = await db
    .from("mass_campaign_emails")
    .select("*")
    .eq("id", emailId)
    .eq("campaign_id", id)
    .single();
  if (!email) return NextResponse.json({ error: "Email introuvable" }, { status: 404 });

  const { instructions } = await req.json();

  // Fetch guide + model
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
    "Mobilise ta connaissance générale de l'entreprise du prospect pour ancrer l'accroche. Si un bloc CONTEXTE ENTREPRISE est fourni, priorise ces informations récentes. Reste factuel : n'invente jamais un fait, un chiffre ou un nom.",
    `L'email doit être signé par : ${senderName}.`,
    "Réponds UNIQUEMENT en JSON valide avec exactement ces deux clés : { \"subject\": \"...\", \"body\": \"...\" }",
    "Le body doit être en texte brut (pas de HTML, pas de markdown).",
    guide ? `\n---\nGUIDE DE PROSPECTION :\n${guide}` : "",
  ].filter(Boolean).join("\n");

  const extra = (typeof email.extra_data === "object" && email.extra_data) ? email.extra_data : {};

  const companyContext = email.company ? await fetchCompanyWebContext(email.company) : "";

  const prospectBlock = [
    `Nom : ${email.first_name} ${email.last_name}`,
    `Email : ${email.email}`,
    `Poste : ${email.job_title || "—"}`,
    `Entreprise : ${email.company || "—"}`,
    `Secteur : ${email.industry || "—"}`,
  ].join("\n");

  const userPrompt = [
    `OBJECTIF DE LA CAMPAGNE :\n${campaign.objective}`,
    `\nINFORMATIONS SUR LE PROSPECT :\n${prospectBlock}`,
    companyContext ? `\nCONTEXTE ENTREPRISE (sources web récentes, à utiliser en priorité si pertinent) :\n${companyContext}` : "",
    `\nEMAIL ACTUEL (à améliorer) :\nObjet : ${email.subject}\n\n${email.body}`,
    instructions ? `\nINSTRUCTIONS DE L'UTILISATEUR POUR LA RÉÉCRITURE :\n${instructions}` : "",
    "\nRéécris cet email en tenant compte des instructions ci-dessus.",
  ].filter(Boolean).join("\n");

  const client = new Anthropic();
  const message = await client.messages.create({
    model: prospectionModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(user.id, prospectionModel, message.usage.input_tokens, message.usage.output_tokens, "mass_prospection_regenerate");

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
  }).eq("id", emailId);

  return NextResponse.json({ subject, body });
}
