import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { dealId, instructions } = await req.json() as { dealId: string; instructions?: string };
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  try {
    const DEAL_PROPS = [
      "dealname", "dealstage", "amount", "closedate", "description",
      "deal_type", "notes_last_contacted", "hs_lastmodifieddate",
    ];
    const propsQuery = DEAL_PROPS.join(",");

    const [dealData, contactAssoc, engagementAssoc] = await Promise.allSettled([
      hubspot(`/crm/v3/objects/deals/${dealId}?properties=${propsQuery}`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    // Get primary contact
    let toEmail = "";
    let contactName = "";
    let contactTitle = "";
    if (contactAssoc.status === "fulfilled") {
      const contactIds: string[] = (contactAssoc.value?.results ?? []).slice(0, 1).map((r: { id: string }) => r.id);
      if (contactIds.length > 0) {
        try {
          const contactData = await hubspot(
            `/crm/v3/objects/contacts/${contactIds[0]}?properties=firstname,lastname,jobtitle,email,company`
          );
          const cp = contactData.properties ?? {};
          toEmail = cp.email ?? "";
          contactName = `${cp.firstname ?? ""} ${cp.lastname ?? ""}`.trim();
          contactTitle = cp.jobtitle ?? "";
        } catch { /* ignore */ }
      }
    }

    // Recent engagements
    let engagementLines = "";
    if (engagementAssoc.status === "fulfilled") {
      const engagementIds: string[] = (engagementAssoc.value?.results ?? []).slice(0, 5).map((r: { id: string }) => r.id);
      if (engagementIds.length > 0) {
        const engDetails = await Promise.allSettled(
          engagementIds.map((eid) =>
            hubspot(`/crm/v3/objects/engagements/${eid}?properties=hs_engagement_type,hs_body_preview,hs_createdate`)
          )
        );
        engagementLines = engDetails
          .filter((e) => e.status === "fulfilled")
          .map((e) => {
            const ep = (e as PromiseFulfilledResult<{ properties: Record<string, string> }>).value?.properties ?? {};
            const type = ep.hs_engagement_type ?? "Activité";
            const date = ep.hs_createdate ? new Date(ep.hs_createdate).toLocaleDateString("fr-FR") : "";
            const preview = (ep.hs_body_preview ?? "").slice(0, 300);
            return preview ? `[${type} ${date}] ${preview}` : "";
          })
          .filter(Boolean)
          .join("\n");
      }
    }

    // Fetch user's prospection guide
    const { data } = await db.from("users").select("prospection_guide").eq("id", user.id).maybeSingle();
    const guide = data?.prospection_guide ?? "";

    const contextBlock = [
      `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "?"}`,
      `Clôture prévue : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "?"}`,
      p.description ? `Description : ${p.description}` : null,
      contactName ? `Contact principal : ${contactName}${contactTitle ? ` — ${contactTitle}` : ""}` : null,
      toEmail ? `Email : ${toEmail}` : null,
      engagementLines ? `\nHistorique des échanges :\n${engagementLines}` : null,
      instructions ? `\nInstructions spécifiques : ${instructions}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = [
      "Tu es un expert en vente B2B pour Coachello, une entreprise de coaching professionnel.",
      "Tu rédiges des emails de suivi de deal personnalisés, humains et percutants.",
      "L'email doit faire avancer le deal vers la prochaine étape.",
      "Réponds UNIQUEMENT en JSON valide : { \"subject\": \"...\", \"body\": \"...\" }",
      "Le body doit être en texte brut (pas de HTML, pas de markdown).",
      guide ? `\n---\nGUIDE DE PROSPECTION :\n${guide}` : "",
    ].filter(Boolean).join("\n");

    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: `Rédige un email de suivi pour ce deal :\n\n${contextBlock}` }],
    });

    logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "deals_email");
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

    return NextResponse.json({ subject, body, toEmail });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
