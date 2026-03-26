import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} → ${res.status}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID manquant" }, { status: 400 });

  const [contactData, engagementsData, companiesData] = await Promise.allSettled([
    hubspot(
      `/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email,jobtitle,company,industry,lifecyclestage,hs_lead_status,notes_last_contacted,phone,city,country,website,linkedin_bio`
    ),
    hubspot(`/crm/v3/objects/contacts/${id}/associations/engagements`),
    hubspot(`/crm/v3/objects/contacts/${id}/associations/companies`),
  ]);

  const contact = contactData.status === "fulfilled" ? contactData.value : null;
  const props = contact?.properties ?? {};

  // Fetch last 5 engagements to build CRM summary
  let crmSummary = "";
  let crmDetails: { type: string; date: string; body: string }[] = [];
  if (engagementsData.status === "fulfilled") {
    const engagementIds: string[] = (engagementsData.value?.results ?? [])
      .map((r: { id: string }) => r.id);

    if (engagementIds.length > 0) {
      const engagementDetails = await Promise.allSettled(
        engagementIds.map((eid) =>
          hubspot(`/crm/v3/objects/engagements/${eid}?properties=hs_engagement_type,hs_body_preview,hs_createdate`)
        )
      );

      const lines: string[] = [];
      for (const e of engagementDetails) {
        if (e.status !== "fulfilled") continue;
        const p = e.value?.properties ?? {};
        const type = p.hs_engagement_type ?? "Activité";
        const date = p.hs_createdate
          ? new Date(p.hs_createdate).toLocaleDateString("fr-FR")
          : "";
        const preview = (p.hs_body_preview ?? "").slice(0, 120);
        if (preview) lines.push(`[${type}${date ? " " + date : ""}] ${preview}`);
      }
      crmSummary = lines.join("\n");
      crmDetails = engagementDetails
        .filter((e) => e.status === "fulfilled")
        .map((e) => {
          const p = (e as PromiseFulfilledResult<{ properties: Record<string, string> }>).value?.properties ?? {};
          return {
            type: p.hs_engagement_type ?? "Activité",
            date: p.hs_createdate ? new Date(p.hs_createdate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "",
            body: p.hs_body_preview ?? "",
          };
        })
        .filter((e) => e.body);
    }
  }

  if (!crmSummary && props.notes_last_contacted) {
    const d = new Date(props.notes_last_contacted);
    crmSummary = `Dernier contact : ${d.toLocaleDateString("fr-FR")}`;
  }

  // Fetch associated company details
  let companyProps: Record<string, string> = {};
  if (companiesData.status === "fulfilled") {
    const companyId = companiesData.value?.results?.[0]?.id;
    if (companyId) {
      try {
        const companyData = await hubspot(
          `/crm/v3/objects/companies/${companyId}?properties=name,domain,industry,city,country,numberofemployees,annualrevenue,description,type,website`
        );
        companyProps = companyData.properties ?? {};
      } catch { /* ignore */ }
    }
  }

  // Build context block for Claude to infer suggestions
  const contextBlock = [
    `Contact : ${props.firstname ?? ""} ${props.lastname ?? ""}, ${props.jobtitle ?? ""} chez ${props.company ?? ""}`,
    props.industry ? `Secteur : ${props.industry}` : null,
    props.lifecyclestage ? `Lifecycle : ${props.lifecyclestage}` : null,
    props.hs_lead_status ? `Lead status : ${props.hs_lead_status}` : null,
    props.linkedin_bio ? `Bio LinkedIn : ${props.linkedin_bio}` : null,
    crmSummary ? `Historique CRM :\n${crmSummary}` : null,
    companyProps.description ? `Description entreprise : ${companyProps.description}` : null,
    companyProps.numberofemployees ? `Effectifs : ${companyProps.numberofemployees}` : null,
    companyProps.annualrevenue ? `Chiffre d'affaires : ${companyProps.annualrevenue}` : null,
    companyProps.website ? `Site web : ${companyProps.website}` : null,
  ].filter(Boolean).join("\n");

  // Ask Claude to infer suggestion fields
  let suggestions = { analysis: "", recentNews: "", companyContext: "", coachingNeed: "", angle: "" };

  if (contextBlock.trim()) {
    try {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: `Tu es un assistant de prospection B2B pour Coachello (coaching professionnel).
À partir des données HubSpot d'un prospect, tu dois inférer 5 champs pour préparer un email de prospection.
Réponds UNIQUEMENT en JSON valide avec ces 5 clés (chaînes vides si tu n'as pas assez d'infos) :
{
  "analysis": "2-3 phrases synthétisant la relation commerciale : ce qu'on sait du contact/entreprise, état des échanges passés, contexte clé à garder en tête pour l'approche. Basé uniquement sur les données fournies.",
  "recentNews": "ce que tu sais sur cette entreprise ou ce secteur depuis ta base de connaissance (positionnement, réputation, tendances connues). NE PAS prétendre que c'est récent ou daté — formule comme un contexte général connu.",
  "companyContext": "contexte de l'entreprise : taille, stade, enjeux, basé sur les données fournies et ta connaissance générale",
  "coachingNeed": "pourquoi cette entreprise ou ce contact pourrait avoir besoin de coaching",
  "angle": "angle d'attaque recommandé pour l'email"
}
IMPORTANT : Ne mentionne jamais de date précise ni d'événement récent que tu ne peux pas vérifier. Laisse un champ vide si tu n'as vraiment rien de pertinent.`,
        messages: [{ role: "user", content: contextBlock }],
      });

      logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "prospection_details");
      const raw = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        suggestions = {
          analysis: parsed.analysis ?? "",
          recentNews: parsed.recentNews ?? "",
          companyContext: parsed.companyContext ?? "",
          coachingNeed: parsed.coachingNeed ?? "",
          angle: parsed.angle ?? "",
        };
      }
    } catch { /* leave suggestions empty on error */ }
  }

  return NextResponse.json({
    id,
    firstName: props.firstname ?? "",
    lastName: props.lastname ?? "",
    email: props.email ?? "",
    jobTitle: props.jobtitle ?? "",
    company: props.company ?? "",
    industry: props.industry ?? "",
    lifecyclestage: props.lifecyclestage ?? "",
    leadStatus: props.hs_lead_status ?? "",
    crmSummary,
    crmDetails,
    // Pre-filled suggestions (empty string = not found, user fills manually)
    suggestedRecentNews: suggestions.recentNews,
    suggestedCompanyContext: suggestions.companyContext,
    suggestedCoachingNeed: suggestions.coachingNeed,
    suggestedAngle: suggestions.angle,
  });
}
