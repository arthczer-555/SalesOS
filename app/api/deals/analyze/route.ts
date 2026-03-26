import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

const DEFAULT_ANALYZE_MODEL = "claude-sonnet-4-6";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
    ];

    const [dealData, contactAssoc, engagementAssoc] = await Promise.allSettled([
      hubspot(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS.join(",")}`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    // Contacts
    let contactLines = "";
    if (contactAssoc.status === "fulfilled") {
      const ids: string[] = (contactAssoc.value?.results ?? []).slice(0, 5).map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        const details = await Promise.allSettled(
          ids.map((cid) => hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle,email`))
        );
        contactLines = details
          .filter((c) => c.status === "fulfilled")
          .map((c) => {
            const cp = (c as PromiseFulfilledResult<{ properties: Record<string, string> }>).value.properties;
            return `${cp.firstname ?? ""} ${cp.lastname ?? ""} — ${cp.jobtitle ?? "?"}`.trim();
          })
          .join(", ");
      }
    }

    // Engagements : batch + meetings + calls + notes (Claap)
    let engagementLines = "";
    if (engagementAssoc.status === "fulfilled") {
      const allIds: string[] = (engagementAssoc.value?.results ?? []).map((r: { id: string }) => r.id);
      if (allIds.length > 0) {
        try {
          const [batchRes, meetingsRes, callsRes, notesRes] = await Promise.allSettled([
            hubspot("/crm/v3/objects/engagements/batch/read", "POST", {
              inputs: allIds.map((id) => ({ id })),
              properties: ["hs_engagement_type", "hs_body_preview", "hs_createdate"],
            }),
            hubspot("/crm/v3/objects/meetings/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
              limit: 15,
            }),
            hubspot("/crm/v3/objects/calls/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
              limit: 15,
            }),
            hubspot("/crm/v3/objects/notes/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_note_body", "hs_timestamp"],
              limit: 10,
            }),
          ]);

          const engLines = batchRes.status === "fulfilled"
            ? (batchRes.value.results ?? [])
              .map((e: { properties: Record<string, string> }) => {
                const ep = e.properties ?? {};
                const type = ep.hs_engagement_type ?? "Activité";
                const date = ep.hs_createdate ? new Date(ep.hs_createdate).toLocaleDateString("fr-FR") : "";
                const body = stripHtml(ep.hs_body_preview ?? "").slice(0, 500);
                return body ? `[${type} ${date}] ${body}` : "";
              })
              .filter(Boolean)
            : [];

          const meetingLines = meetingsRes.status === "fulfilled"
            ? (meetingsRes.value.results ?? [])
              .map((m: { properties: Record<string, string> }) => {
                const mp = m.properties ?? {};
                const date = mp.hs_timestamp ? new Date(mp.hs_timestamp).toLocaleDateString("fr-FR") : "";
                const title = mp.hs_meeting_title ?? "Réunion";
                const body = stripHtml(mp.hs_meeting_body ?? "").slice(0, 2000);
                return body ? `[MEETING ${date}] ${title}\n${body}` : "";
              })
              .filter(Boolean)
            : [];

          const callLines = callsRes.status === "fulfilled"
            ? (callsRes.value.results ?? [])
              .map((c: { properties: Record<string, string> }) => {
                const cp = c.properties ?? {};
                const date = cp.hs_timestamp ? new Date(cp.hs_timestamp).toLocaleDateString("fr-FR") : "";
                const title = cp.hs_call_title ?? "Appel";
                const body = stripHtml(cp.hs_call_body ?? "").slice(0, 2000);
                return body ? `[CALL ${date}] ${title}\n${body}` : "";
              })
              .filter(Boolean)
            : [];

          const noteLines = notesRes.status === "fulfilled"
            ? (notesRes.value.results ?? [])
              .map((n: { properties: Record<string, string> }) => {
                const np = n.properties ?? {};
                const date = np.hs_timestamp ? new Date(np.hs_timestamp).toLocaleDateString("fr-FR") : "";
                const body = stripHtml(np.hs_note_body ?? "").slice(0, 3000);
                return body ? `[NOTE ${date}] ${body}` : "";
              })
              .filter(Boolean)
            : [];

          engagementLines = [...meetingLines, ...callLines, ...noteLines, ...engLines].join("\n\n");
        } catch {
          // fallback: skip engagements if batch fails
        }
      }
    }

    // Fetch cached AI score from deal_scores table
    let scoreContext = "Score IA : non disponible (deal non scoré)";
    if (process.env.SUPABASE_URL) {
      const { data: cached } = await db
        .from("deal_scores")
        .select("score, reasoning, next_action, scored_at")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (cached?.score) {
        const s = cached.score as { total: number; components: { name: string; earned: number; max: number }[]; reliability: number };
        const componentLines = (s.components ?? [])
          .map((c) => `  - ${c.name}: ${c.earned}/${c.max}`)
          .join("\n");
        scoreContext = [
          `Score IA : ${s.total}/100`,
          `Détail :\n${componentLines}`,
          cached.reasoning ? `Reasoning : ${cached.reasoning}` : null,
          cached.next_action ? `Next action suggérée : ${cached.next_action}` : null,
        ].filter(Boolean).join("\n");
      }
    }

    const contextBlock = [
      `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "?"}`,
      `Clôture : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "?"} | Probabilité : ${p.hs_deal_stage_probability ?? "?"}%`,
      p.description ? `Description : ${p.description}` : null,
      contactLines ? `Contacts : ${contactLines}` : "Contacts : aucun",
      `\n${scoreContext}`,
      engagementLines ? `\nTous les échanges HubSpot :\n${engagementLines}` : "\nÉchanges : aucun enregistré",
    ].filter(Boolean).join("\n");

    // Model from model_preferences
    let analyzeModel = DEFAULT_ANALYZE_MODEL;
    try {
      const { data: globalModelEntry } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
      if (globalModelEntry?.content) {
        analyzeModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).deals_analyze ?? DEFAULT_ANALYZE_MODEL;
      }
    } catch { /* keep default */ }

    const client = new Anthropic();
    const message = await client.messages.create({
      model: analyzeModel,
      max_tokens: 3000,
      system: `Tu es un expert en vente B2B pour Coachello (coaching professionnel).
Analyse ce deal commercial en profondeur à partir de TOUTES les données disponibles (score IA, échanges, contacts, contexte).
Sois hyper précis et factuel — base chaque analyse sur des éléments concrets tirés des échanges.

Retourne UNIQUEMENT un JSON valide avec cette structure :
{
  "synthese": "2-3 phrases résumant l'état réel du deal et sa probabilité de close",
  "riskLevel": "Faible" | "Moyen" | "Élevé",
  "dynamique": {
    "momentum": "En accélération" | "Stable" | "En perte de vitesse",
    "analyse": "analyse précise de la dynamique : fréquence et qualité des échanges récents, réactivité du prospect, signaux de progression ou de stagnation"
  },
  "qualification": {
    "budget": "analyse du budget : confirmé/en discussion/inconnu, montant connu, signaux budgétaires identifiés dans les échanges",
    "authority": "analyse de l'autorité : qui est le vrai décisionnaire, niveau d'accès réel, composition du buying group, présence d'un sponsor exécutif",
    "need": "analyse du besoin : urgence réelle, contexte business précis, problème métier que Coachello résout pour ce client",
    "timeline": "analyse du calendrier : deadline réelle vs indicative, risques de glissement, facteurs d'urgence ou de blocage",
    "fit": "analyse du fit stratégique : adéquation de l'offre Coachello avec le besoin, points forts et limites du positionnement"
  },
  "signaux": {
    "positifs": ["signal factuel 1", "signal factuel 2", "signal factuel 3"],
    "negatifs": ["signal factuel 1", "signal factuel 2"]
  },
  "risques": [
    { "risque": "description précise du risque", "severite": "Faible" | "Moyen" | "Élevé" }
  ],
  "scoreInsight": "lecture précise du score IA : quelles dimensions sont sous-évaluées ou surévaluées et pourquoi, ce qui ferait progresser le score",
  "prochaines_etapes": [
    { "action": "action concrète et précise", "priorite": "Urgent" | "Moyen" | "Faible", "impact": "impact attendu sur le deal" }
  ]
}`,
      messages: [{ role: "user", content: contextBlock }],
    });

    logUsage(user.id, analyzeModel, message.usage.input_tokens, message.usage.output_tokens, "deals_analyze");
    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Réponse IA invalide");

    const analysis = JSON.parse(jsonMatch[0]);
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
