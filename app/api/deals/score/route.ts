import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectModel, type DealScore } from "@/lib/deal-scoring";
import { logUsage } from "@/lib/log-usage";

const DEFAULT_SCORE_MODEL = "claude-haiku-4-5-20251001";

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

// Max points per dimension per model
const MODEL_MAXES = {
  generic:        { authority: 25, budget: 15, timeline: 15, business_need: 20, engagement: 15, strategic_fit: 10 },
  human_coaching: { authority: 25, budget: 20, timeline: 15, business_need: 20, engagement: 10, strategic_fit: 10 },
  ai_coaching:    { authority: 20, budget: 15, timeline: 20, business_need: 20, engagement: 15, strategic_fit: 10 },
};

const DIMENSION_NAMES = {
  generic:        ["Authority & Buying Group", "Budget Clarity", "Timeline Certainty", "Business Need Strength", "Engagement & Momentum", "Strategic Fit"],
  human_coaching: ["Authority & Governance", "Budget & Procurement", "Timeline", "Business Need Depth", "Engagement", "Strategic Expansion"],
  ai_coaching:    ["Authority", "Budget", "Timeline", "Business Urgency", "Engagement & Usage Intent", "Strategic AI Fit"],
};

export async function scoreOneDeal(dealId: string, userId: string | null, claudeModel = DEFAULT_SCORE_MODEL): Promise<DealScore & { reasoning: string; next_action: string; qualification: Record<string, string | null> }> {
  const DEAL_PROPS = [
    "dealname", "dealstage", "amount", "closedate", "description",
    "hs_deal_stage_probability", "deal_type", "notes_last_contacted", "hs_lastmodifieddate",
  ];

  const [dealData, contactAssoc, engagementAssoc] = await Promise.allSettled([
    hubspot(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS.join(",")}`),
    hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
    hubspot(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
  ]);

  const p = dealData.status === "fulfilled" ? (dealData.value?.properties ?? {}) : {};
  const model = detectModel(p.deal_type);
  const maxes = MODEL_MAXES[model];
  const names = DIMENSION_NAMES[model];

  // Contacts
  let contactLines = "";
  if (contactAssoc.status === "fulfilled") {
    const ids: string[] = (contactAssoc.value?.results ?? []).slice(0, 3).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      const details = await Promise.allSettled(
        ids.map((cid) => hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle`))
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

  // Engagements — fetch ALL via batch read + full meeting/call bodies
  let engagementLines = "";
  if (engagementAssoc.status === "fulfilled") {
    const allIds: string[] = (engagementAssoc.value?.results ?? []).map((r: { id: string }) => r.id);
    if (allIds.length > 0) {
      try {
        const [batchRes, meetingsRes, callsRes] = await Promise.allSettled([
          hubspot("/crm/v3/objects/engagements/batch/read", "POST", {
            inputs: allIds.map((id) => ({ id })),
            properties: ["hs_engagement_type", "hs_body_preview", "hs_createdate"],
          }),
          hubspot("/crm/v3/objects/meetings/search", "POST", {
            filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
            properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
            limit: 10,
          }),
          hubspot("/crm/v3/objects/calls/search", "POST", {
            filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
            properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
            limit: 10,
          }),
        ]);

        const engLines = batchRes.status === "fulfilled"
          ? (batchRes.value.results ?? [])
            .map((e: { properties: Record<string, string> }) => {
              const ep = e.properties ?? {};
              const type = ep.hs_engagement_type ?? "Activité";
              const date = ep.hs_createdate ? new Date(ep.hs_createdate).toLocaleDateString("fr-FR") : "";
              const body = (ep.hs_body_preview ?? "").slice(0, 500);
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
              const body = (mp.hs_meeting_body ?? "").slice(0, 1500);
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
              const body = (cp.hs_call_body ?? "").slice(0, 1500);
              return body ? `[CALL ${date}] ${title}\n${body}` : "";
            })
            .filter(Boolean)
          : [];

        engagementLines = [...meetingLines, ...callLines, ...engLines].join("\n\n");
      } catch {
        // fallback: skip engagements if batch fails
      }
    }
  }

  const context = [
    `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Probabilité : ${p.hs_deal_stage_probability ?? "?"}%`,
    `Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "non renseigné"}`,
    `Clôture : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "non renseignée"}`,
    p.description ? `Description : ${p.description}` : null,
    contactLines ? `Contacts : ${contactLines}` : "Contacts : aucun",
    engagementLines ? `\nÉchanges récents :\n${engagementLines}` : "Échanges : aucun enregistré",
  ].filter(Boolean).join("\n");

  const systemPrompt = `Tu es un expert en vente B2B pour Coachello (coaching professionnel).
Analyse le deal ci-dessous et attribue un score entier entre 0 et le maximum pour chaque dimension.
Tu peux utiliser n'importe quelle valeur entière dans cet intervalle — sois précis et nuancé.
Modèle détecté : ${model}.

=== CRITÈRES DE SCORING ===

1. ${names[0]} (0 à ${maxes.authority} pts)
Évalue l'autorité du contact principal à partir de son titre/rôle et des échanges.
- Très élevé (proche de ${maxes.authority}) : sponsor exécutif, C-level, DG, DRH, VP avec pouvoir de décision et budget
- Élevé : directeur fonctionnel impliqué avec budget propre, décisionnaire identifié
- Moyen : manager intermédiaire impliqué mais pas décisionnaire final, doit convaincre au-dessus
- Faible : champion sans autorité budgétaire, employé enthousiaste
- Nul (0) : aucun contact identifié

2. ${names[1]} (0 à ${maxes.budget} pts)
Évalue la clarté et la disponibilité du budget à partir du montant, des échanges, de la description.
- Très élevé (proche de ${maxes.budget}) : budget explicitement confirmé et approuvé
- Élevé : budget identifié, en cours d'approbation, signaux positifs clairs
- Moyen : discussion budget amorcée, aucune confirmation mais pas de blocage
- Faible : budget non mentionné, vague, ou sujet sensible
- Nul (0) : budget refusé ou deal explicitement sans budget

3. ${names[2]} (0 à ${maxes.timeline} pts)
Évalue l'urgence et la précision du calendrier de décision à partir de la closedate et des échanges.
- Très élevé (proche de ${maxes.timeline}) : décision attendue dans les 30 jours, deadline ferme
- Élevé : décision dans les 90 jours, calendrier discuté
- Moyen : décision dans les 6 mois, horizon mentionné mais flou
- Faible : délai au-delà de 6 mois ou très incertain
- Nul (0) : aucune information sur le calendrier

4. ${names[3]} (0 à ${maxes.business_need} pts)
Évalue l'intensité et la clarté du besoin métier à partir de la description et des échanges.
- Très élevé (proche de ${maxes.business_need}) : douleur critique, blocage business, urgence clairement exprimée
- Élevé : besoin significatif avec objectifs concrets et ROI attendu articulé
- Moyen : besoin réel mais projet d'amélioration sans urgence forte
- Faible : exploration, curiosité initiale, besoin mal défini
- Nul (0) : aucun besoin identifié

5. ${names[4]} (0 à ${maxes.engagement} pts)
Évalue la dynamique relationnelle à partir de la fréquence et qualité des échanges récents.
- Très élevé (proche de ${maxes.engagement}) : échanges fréquents et récents (< 7 jours), momentum fort, multiples interlocuteurs
- Élevé : échanges réguliers récents, bonne réactivité
- Moyen : contact sporadique (7–15 jours), engagement variable
- Faible : peu d'activité récente (15–30 jours), signaux tièdes
- Nul (0) : silence total (> 30 jours) ou aucun échange enregistré

6. ${names[5]} (0 à ${maxes.strategic_fit} pts)
Évalue l'adéquation de la situation du prospect avec l'offre Coachello (coaching professionnel/managérial).
- Très élevé (proche de ${maxes.strategic_fit}) : transformation RH, développement du leadership, coaching d'équipes — fit évident
- Élevé : entreprise en croissance, besoin clair de montée en compétences managériales
- Moyen : besoin de formation ou de développement, mais pas spécifiquement coaching
- Faible : secteur ou contexte partiellement aligné
- Nul (0) : besoin sans rapport avec l'offre Coachello

=== INSTRUCTIONS ===
- Attribue n'importe quel entier entre 0 et le maximum — pas besoin de valeurs rondes.
- Nuance ton score selon les signaux spécifiques du deal (ex: 17/25 si l'autorité est forte mais pas encore confirmée).
- Si une dimension manque totalement d'informations, donne la moitié du maximum arrondie.
- Sois strict : un score élevé doit être justifié par des éléments concrets dans les échanges ou la description.
- Réponds UNIQUEMENT en JSON valide :
{
  "authority": X,
  "budget": X,
  "timeline": X,
  "business_need": X,
  "engagement": X,
  "strategic_fit": X,
  "reasoning": "explication globale en 1 phrase mentionnant les points forts et faibles",
  "next_action": "conseil concret et actionnable en 1-2 phrases pour faire avancer ce deal au prochain stade",
  "qualification": {
    "budget": "valeur/fourchette connue ou null",
    "estimatedBudget": "estimation chiffrée si disponible ou null",
    "authority": "nom et rôle du décisionnaire identifié ou null",
    "need": "besoin principal qualifié en une phrase ou null",
    "champion": "nom du champion interne si mentionné ou null",
    "needDetailed": "description détaillée du besoin ou null",
    "timeline": "horizon temporel identifié (ex: Q3 2025) ou null",
    "strategicFit": "raison concrète du fit avec Coachello ou null"
  }
}`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: claudeModel,
    max_tokens: 768,
    system: systemPrompt,
    messages: [{ role: "user", content: context }],
  });

  logUsage(userId, claudeModel, message.usage.input_tokens, message.usage.output_tokens, "deals_score");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Réponse IA invalide");

  const ai = JSON.parse(jsonMatch[0]);

  // Clamp values to their max
  const authority = Math.min(Math.max(Math.round(ai.authority ?? 0), 0), maxes.authority);
  const budget = Math.min(Math.max(Math.round(ai.budget ?? 0), 0), maxes.budget);
  const timeline = Math.min(Math.max(Math.round(ai.timeline ?? 0), 0), maxes.timeline);
  const business_need = Math.min(Math.max(Math.round(ai.business_need ?? 0), 0), maxes.business_need);
  const engagement = Math.min(Math.max(Math.round(ai.engagement ?? 0), 0), maxes.engagement);
  const strategic_fit = Math.min(Math.max(Math.round(ai.strategic_fit ?? 0), 0), maxes.strategic_fit);
  const total = authority + budget + timeline + business_need + engagement + strategic_fit;

  const components = [
    { name: names[0], earned: authority, max: maxes.authority, filled: true },
    { name: names[1], earned: budget, max: maxes.budget, filled: true },
    { name: names[2], earned: timeline, max: maxes.timeline, filled: true },
    { name: names[3], earned: business_need, max: maxes.business_need, filled: true },
    { name: names[4], earned: engagement, max: maxes.engagement, filled: true },
    { name: names[5], earned: strategic_fit, max: maxes.strategic_fit, filled: true },
  ];

  // Reliability = how much context was available (proxied by non-empty fields)
  const contextFields = [p.amount, p.closedate, contactLines, engagementLines, p.description].filter(Boolean).length;
  const reliability = Math.min(contextFields, 5) as 0 | 1 | 2 | 3 | 4 | 5;

  const score: DealScore = { total, components, reliability };
  const reasoning: string = ai.reasoning ?? "";
  const next_action: string = ai.next_action ?? "";
  const qualification: Record<string, string | null> = {
    budget:         ai.qualification?.budget         ?? null,
    estimatedBudget: ai.qualification?.estimatedBudget ?? null,
    authority:      ai.qualification?.authority      ?? null,
    need:           ai.qualification?.need           ?? null,
    champion:       ai.qualification?.champion       ?? null,
    needDetailed:   ai.qualification?.needDetailed   ?? null,
    timeline:       ai.qualification?.timeline       ?? null,
    strategicFit:   ai.qualification?.strategicFit  ?? null,
  };

  return { ...score, reasoning, next_action, qualification };
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { dealId } = await req.json();
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  try {



    const { data: globalModelEntry } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
    let scoreModel = DEFAULT_SCORE_MODEL;
    try { if (globalModelEntry?.content) scoreModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).deals_score ?? DEFAULT_SCORE_MODEL; } catch { /* keep default */ }
    const result = await scoreOneDeal(dealId, user.id, scoreModel);

    await db.from("deal_scores").upsert({
      deal_id: dealId,
      score: { total: result.total, components: result.components, reliability: result.reliability },
      reasoning: result.reasoning,
      next_action: result.next_action,
      scored_at: new Date().toISOString(),
    }, { onConflict: "deal_id" });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
