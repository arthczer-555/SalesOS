import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Strip lone surrogates that break JSON serialization
function sanitizeString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { dealId, instructions, currentSubject, currentBody } = await req.json() as {
    dealId: string;
    instructions?: string;
    currentSubject?: string;
    currentBody?: string;
  };
  if (!dealId) return NextResponse.json({ error: "dealId missing" }, { status: 400 });

  // Avec des instructions + un brouillon existant, on retouche au lieu de repartir de zéro.
  const rewriteInstructions = (instructions ?? "").trim();
  const baseSubject = (currentSubject ?? "").trim();
  const baseBody = (currentBody ?? "").trim();
  const isRewrite = Boolean(rewriteInstructions && baseBody);

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
            const preview = sanitizeString((ep.hs_body_preview ?? "").slice(0, 300));
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
      p.description ? `Description : ${sanitizeString(p.description)}` : null,
      contactName ? `Contact principal : ${contactName}${contactTitle ? ` - ${contactTitle}` : ""}` : null,
      toEmail ? `Email : ${toEmail}` : null,
      engagementLines ? `\nHistorique des échanges :\n${engagementLines}` : null,
      isRewrite ? `\nEMAIL ACTUEL (à retoucher) :\nObjet : ${baseSubject}\n\n${baseBody}` : null,
      rewriteInstructions
        ? `\n${isRewrite ? "INSTRUCTIONS DE RÉÉCRITURE DE L'UTILISATEUR" : "Instructions spécifiques"} : ${rewriteInstructions}`
        : null,
      isRewrite
        ? "\nRetouche cet email en respectant ces instructions. Ne change que ce qui est demandé, garde le reste tel quel."
        : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = [
      "Tu es un expert en vente B2B pour Coachello, une entreprise de coaching professionnel.",
      "Tu rédiges des emails de suivi de deal personnalisés, humains et percutants.",
      "L'email doit faire avancer le deal vers la prochaine étape.",
      isRewrite
        ? "LANGUE : garde celle de l'EMAIL ACTUEL. Les instructions de réécriture ne définissent PAS la langue, sauf demande explicite de l'utilisateur. Rédige TOUT (subject, body, signature) dans cette langue."
        : "LANGUE : détecte la langue dominante à partir, dans l'ordre, des Instructions spécifiques, puis de l'Historique des échanges, puis de la Description du deal. Sinon, repli sur le français. Rédige TOUT (subject, body, signature) dans cette langue. Si la source est en anglais, écris en anglais ; en espagnol, en espagnol ; etc.",
      NO_EM_DASH_RULE,
      "Réponds UNIQUEMENT en JSON valide : { \"subject\": \"...\", \"body\": \"...\" }",
      "Le body doit être en texte brut (pas de HTML, pas de markdown).",
      guide ? `\n---\nGUIDE DE PROSPECTION :\n${guide}` : "",
    ].filter(Boolean).join("\n");

    const { data: modelPrefs } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
    const emailModel = (() => { try { return (JSON.parse(modelPrefs?.content ?? "{}") as Record<string, string>).deals_email ?? "claude-haiku-4-5-20251001"; } catch { return "claude-haiku-4-5-20251001"; } })();

    const client = anthropicClient();
    const message = await client.messages.create({
      model: emailModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: `Rédige un email de suivi pour ce deal :\n\n${contextBlock}` }],
    });

    logUsage(
      user.id,
      emailModel,
      message.usage.input_tokens,
      message.usage.output_tokens,
      isRewrite ? "deals_email_rewrite" : "deals_email",
    );
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
    subject = stripEmDashes(subject);
    body = stripEmDashes(body);

    return NextResponse.json({ subject, body, toEmail });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
