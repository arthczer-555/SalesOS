import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { calcScore, scoreBadge, reliabilityLabel, type DealForScoring } from "@/lib/deal-scoring";
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

  const { dealId } = await req.json();
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  try {
    const DEAL_PROPS = [
      "dealname", "dealstage", "amount", "closedate",
      "hubspot_owner_id", "hs_lastmodifieddate", "notes_last_contacted",
      "hs_deal_stage_probability", "deal_type", "description",
      "authority_status", "budget_status", "decision_timeline",
      "business_need_level", "strategic_fit",
    ];
    const propsQuery = DEAL_PROPS.join(",");

    const [dealData, contactAssoc, engagementAssoc] = await Promise.allSettled([
      hubspot(`/crm/v3/objects/deals/${dealId}?properties=${propsQuery}`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    const scoring: DealForScoring = {
      authority_status: p.authority_status,
      budget_status: p.budget_status,
      decision_timeline: p.decision_timeline,
      business_need_level: p.business_need_level,
      strategic_fit: p.strategic_fit,
      deal_type: p.deal_type,
      notes_last_contacted: p.notes_last_contacted,
      hs_lastmodifieddate: p.hs_lastmodifieddate,
    };
    const score = calcScore(scoring);
    const badge = scoreBadge(score.total);
    const reliability = reliabilityLabel(score.reliability);

    // Fetch contact names
    let contactList = "";
    if (contactAssoc.status === "fulfilled") {
      const contactIds: string[] = (contactAssoc.value?.results ?? []).slice(0, 3).map((r: { id: string }) => r.id);
      if (contactIds.length > 0) {
        const contactDetails = await Promise.allSettled(
          contactIds.map((cid) => hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle`))
        );
        contactList = contactDetails
          .filter((c) => c.status === "fulfilled")
          .map((c) => {
            const cp = (c as PromiseFulfilledResult<{ properties: Record<string, string> }>).value.properties;
            return `${cp.firstname ?? ""} ${cp.lastname ?? ""} (${cp.jobtitle ?? "?"})`.trim();
          })
          .join(", ");
      }
    }

    // Fetch recent engagements
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
            const preview = (ep.hs_body_preview ?? "").slice(0, 200);
            return preview ? `[${type} ${date}] ${preview}` : "";
          })
          .filter(Boolean)
          .join("\n");
      }
    }

    // Score component summary
    const scoreLines = score.components
      .map((c) => `- ${c.name}: ${c.earned}/${c.max}${c.filled ? "" : " (non rempli)"}`)
      .join("\n");

    const contextBlock = [
      `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "?"}`,
      `Clôture : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "?"} | Probabilité : ${p.hs_deal_stage_probability ?? "?"}%`,
      p.description ? `Description : ${p.description}` : null,
      contactList ? `Contacts : ${contactList}` : null,
      `\nScore : ${score.total}/100 (${badge.label}) — Fiabilité : ${reliability}`,
      `Détail score :\n${scoreLines}`,
      engagementLines ? `\nActivité récente :\n${engagementLines}` : null,
    ].filter(Boolean).join("\n");

    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `Tu es un expert en vente B2B pour Coachello (coaching professionnel).
Analyse ce deal commercial et retourne UNIQUEMENT un JSON valide avec cette structure :
{
  "summary": "résumé de la situation en 2-3 phrases",
  "positiveSignals": ["signal 1", "signal 2", "signal 3"],
  "negativeSignals": ["signal 1", "signal 2"],
  "nextSteps": ["action recommandée 1", "action recommandée 2", "action recommandée 3"],
  "riskLevel": "Faible" | "Moyen" | "Élevé",
  "scoringInsight": "explication du score et ce qui le ferait progresser (1-2 phrases)"
}
Base-toi uniquement sur les données disponibles. Sois concis et actionnable.`,
      messages: [{ role: "user", content: contextBlock }],
    });

    logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "deals_analyze");
    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Réponse IA invalide");

    const analysis = JSON.parse(jsonMatch[0]);
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
