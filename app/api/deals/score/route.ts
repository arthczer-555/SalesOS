import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectModel, type DealScore } from "@/lib/deal-scoring";
import { logUsage } from "@/lib/log-usage";

const DEFAULT_SCORE_MODEL = "claude-haiku-4-5-20251001";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  generic:        { authority: 20, budget: 15, timeline: 10, business_need: 15, engagement: 25, strategic_fit: 5, competition: 10 },
  human_coaching: { authority: 20, budget: 15, timeline: 10, business_need: 15, engagement: 25, strategic_fit: 5, competition: 10 },
  ai_coaching:    { authority: 15, budget: 15, timeline: 10, business_need: 15, engagement: 25, strategic_fit: 5, competition: 15 },
};

const DIMENSION_NAMES = {
  generic:        ["Authority & Buying Group", "Budget Clarity", "Timeline", "Business Need", "Engagement & Momentum", "Strategic Fit", "Compétition"],
  human_coaching: ["Authority & Governance", "Budget", "Timeline", "Business Need", "Engagement & Momentum", "Strategic Fit", "Compétition"],
  ai_coaching:    ["Authority", "Budget", "Timeline", "Business Urgency", "Engagement & Momentum", "Strategic AI Fit", "Compétition"],
};

export async function scoreOneDeal(dealId: string, userId: string | null, claudeModel = DEFAULT_SCORE_MODEL): Promise<DealScore & { reasoning: string; next_action: string; qualification: Record<string, string | null> }> {
  const DEAL_PROPS = [
    "dealname", "dealstage", "amount", "closedate", "description",
    "hs_deal_stage_probability", "deal_type", "notes_last_contacted", "hs_lastmodifieddate",
    "createdate",
    // Custom qualification fields (may or may not be filled)
    "authority_status", "budget_status", "decision_timeline", "business_need_level", "strategic_fit",
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

  // CRM qualification fields
  const crmFields = [
    p.authority_status ? `authority_status = "${p.authority_status}"` : null,
    p.budget_status ? `budget_status = "${p.budget_status}"` : null,
    p.decision_timeline ? `decision_timeline = "${p.decision_timeline}"` : null,
    p.business_need_level ? `business_need_level = "${p.business_need_level}"` : null,
    p.strategic_fit ? `strategic_fit = "${p.strategic_fit}"` : null,
  ].filter(Boolean);

  const dealAge = p.createdate ? Math.floor((Date.now() - new Date(p.createdate).getTime()) / 864e5) : null;

  const context = [
    `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Probabilité : ${p.hs_deal_stage_probability ?? "?"}%`,
    `Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "non renseigné"}`,
    `Clôture : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "non renseignée"}`,
    dealAge !== null ? `Âge du deal : ${dealAge} jours` : null,
    p.description ? `Description : ${p.description}` : null,
    crmFields.length > 0 ? `\nChamps CRM renseignés :\n${crmFields.join("\n")}` : "Champs CRM de qualification : aucun renseigné",
    contactLines ? `Contacts : ${contactLines}` : "Contacts : aucun",
    engagementLines ? `\nÉchanges récents :\n${engagementLines}` : "Échanges : aucun enregistré",
  ].filter(Boolean).join("\n");

  const systemPrompt = `Tu es un expert en vente B2B pour Coachello (coaching professionnel).
Analyse le deal ci-dessous et attribue un score entier entre 0 et le maximum pour chaque dimension.
Tu peux utiliser n'importe quelle valeur entière dans cet intervalle — sois précis et EXIGEANT.
Modèle détecté : ${model}.

=== MÉTHODE DE SCORING ===

Tu reçois deux sources d'information :
1. **Champs CRM** : valeurs renseignées manuellement dans HubSpot (peuvent être présentes ou absentes)
2. **Conversations** : emails, meetings, calls, notes associés au deal

RÈGLE FONDAMENTALE : croise TOUJOURS les deux sources.
- Champ CRM rempli → utilise-le comme base, mais VÉRIFIE dans les conversations. Si les conversations contredisent le champ, c'est la réalité des conversations qui prime. Signale l'incohérence dans le reasoning.
- Champ CRM vide → déduis depuis les conversations uniquement.
- Si AUCUNE information (champ vide + pas de conversation pertinente) → score 0 sur cette dimension. Ne donne JAMAIS un score par défaut ou "au milieu" par manque d'info.

=== CRITÈRES DE SCORING ===

1. ${names[0]} (0 à ${maxes.authority} pts)
Évalue qui est dans la boucle et si le décisionnaire final est identifié et engagé.
- ${maxes.authority} pts : sponsor exécutif (C-level, DG, DRH, VP) identifié ET directement engagé dans les échanges
- 14 pts : senior decision maker contacté, décisionnaire identifié mais pas encore engagé directement
- 8 pts : middle manager impliqué, remonte au décisionnaire mais pas de contact direct
- 4 pts : champion enthousiaste sans aucune autorité budgétaire
- 0 pts : aucun contact identifié ou interlocuteur inconnu

2. ${names[1]} (0 à ${maxes.budget} pts)
Évalue la clarté et la disponibilité du budget.
- ${maxes.budget} pts : budget confirmé, approuvé, montant connu
- 10 pts : budget identifié, en cours d'approbation, signaux positifs
- 6 pts : discussion budget amorcée, pas de confirmation
- 3 pts : budget évoqué vaguement, aucun chiffre
- 0 pts : budget jamais mentionné ou explicitement refusé

3. ${names[2]} (0 à ${maxes.timeline} pts)
Évalue la précision du calendrier de décision.
- ${maxes.timeline} pts : décision dans les 30 jours, deadline ferme confirmée par le prospect
- 7 pts : décision dans les 90 jours, calendrier discuté concrètement
- 4 pts : horizon 3-6 mois, mentionné mais flou
- 1 pt : au-delà de 6 mois
- 0 pts : aucune information sur le calendrier

4. ${names[3]} (0 à ${maxes.business_need} pts) — SCORING DUR
Évalue l'intensité RÉELLE du besoin, pas ce qu'on voudrait croire.
- ${maxes.business_need} pts : douleur critique DOCUMENTÉE — le prospect a verbalisé le problème ET son impact chiffré/concret (turnover, perte de productivité, échec de transformation, etc.)
- 9 pts : besoin significatif et clair, objectifs concrets identifiés, mais pas encore chiffré en impact
- 4 pts : "nice to have" — intéressé par le coaching mais pas urgent, pas de douleur identifiée
- 1 pt : exploration pure — le prospect est curieux, aucun problème concret identifié
- 0 pts : aucun besoin identifié ou pas assez d'info pour juger
IMPORTANT : Un prospect qui dit "on veut du coaching" sans expliquer POURQUOI = 4 max. Pour aller au-dessus de 9, il faut un impact business articulé.

5. ${names[4]} (0 à ${maxes.engagement} pts) — SCORING TRÈS DUR
Évalue la dynamique RÉELLE du deal à partir de signaux cumulés. Un seul email récent ne vaut PAS 25.
Additionne les signaux suivants :
- Recency (dernier échange < 7j = +4, 7-14j = +2, > 14j = 0)
- Volume (5+ engagements sur 30j = +5, 3-4 = +3, 1-2 = +1, 0 = 0)
- Variété (au moins 2 types d'échange — ex: email + call, call + meeting = +3)
- Bilatéral (au moins 1 réponse/email entrant ou meeting initié par le prospect dans les 30j = +4, sinon 0)
- Multi-threading (2+ contacts/interlocuteurs impliqués = +4, 1 seul = 0)
- Stagnation (deal créé depuis > 60 jours ET aucun changement de stage récent = −5)
Le max théorique est 20-22 sur ${maxes.engagement}. Avoir ${maxes.engagement} = deal exceptionnellement actif et engagé bilatéralement.
IMPORTANT : un seul email envoyé sans réponse la semaine dernière = ~5 pts max. Sois TRÈS strict.

6. ${names[5]} (0 à ${maxes.strategic_fit} pts)
Évalue l'adéquation avec l'offre Coachello (coaching professionnel/managérial).
- ${maxes.strategic_fit} pts : transformation RH, développement du leadership, coaching d'équipes — fit parfait
- 4 pts : entreprise en croissance, montée en compétences managériales
- 2 pts : besoin de formation mais pas spécifiquement coaching
- 0 pts : besoin sans rapport avec Coachello

7. ${names[6]} (0 à ${maxes.competition} pts)
Évalue la position compétitive de Coachello sur ce deal.
- ${maxes.competition} pts : Coachello seul en lice, confirmé par le prospect (pas de benchmark, pas de RFP multi-fournisseurs)
- 7 pts : aucune mention de concurrent dans les échanges
- 3 pts : concurrent probable (RFP multi-fournisseurs, benchmark mentionné, comparaison évoquée) mais pas confirmé
- 0 pts : concurrent(s) identifié(s) et en compétition directe (nommé dans les échanges ou shortlist)
Indices de compétition : mentions de "benchmark", "autres prestataires", "comparaison", noms de concurrents (BetterUp, CoachHub, Ezra, MentorCity, etc.), RFP envoyé à plusieurs, demande de "références" comparatives.

=== INSTRUCTIONS ===
- Sois STRICT et EXIGEANT. Un score élevé doit être justifié par des éléments CONCRETS dans les conversations ou les champs CRM.
- Si une dimension manque totalement d'informations (pas de champ CRM, pas de conversation), donne 0 — pas un score "par défaut".
- Si un champ CRM contredit les conversations, mentionne-le dans crm_alert.
- REASONING : chaque point doit faire 5-8 mots MAX. Pas d'explication, pas de détail. Concentre-toi sur la DYNAMIQUE du deal (momentum, engagement, progression), PAS sur la qualification (budget, authority, etc. sont déjà dans les scores et la qualification). Max 3 strengths, 3 weaknesses.
- Réponds UNIQUEMENT en JSON valide :
{
  "authority": X,
  "budget": X,
  "timeline": X,
  "business_need": X,
  "engagement": X,
  "strategic_fit": X,
  "reasoning": {
    "strengths": ["signal positif court (5-8 mots max)", "autre signal"],
    "weaknesses": ["signal négatif court (5-8 mots max)", "autre signal"],
    "crm_alert": "incohérence CRM en une phrase courte, ou null"
  },
  "competition": X,
  "next_action": "conseil concret et actionnable en 1-2 phrases pour faire avancer ce deal. Si concurrent détecté, inclure une reco de différenciation/urgence/lock-in.",
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
    max_tokens: 1500,
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
  const competition = Math.min(Math.max(Math.round(ai.competition ?? 0), 0), maxes.competition);
  const total = authority + budget + timeline + business_need + engagement + strategic_fit + competition;

  const components = [
    { name: names[4], earned: engagement, max: maxes.engagement, filled: true },
    { name: names[0], earned: authority, max: maxes.authority, filled: true },
    { name: names[3], earned: business_need, max: maxes.business_need, filled: true },
    { name: names[1], earned: budget, max: maxes.budget, filled: true },
    { name: names[6], earned: competition, max: maxes.competition, filled: true },
    { name: names[2], earned: timeline, max: maxes.timeline, filled: true },
    { name: names[5], earned: strategic_fit, max: maxes.strategic_fit, filled: true },
  ];

  // Reliability = how much context was available (proxied by non-empty fields)
  const contextFields = [p.amount, p.closedate, contactLines, engagementLines, p.description].filter(Boolean).length;
  const reliability = Math.min(contextFields, 5) as 0 | 1 | 2 | 3 | 4 | 5;

  const score: DealScore = { total, components, reliability };
  // Format reasoning as structured bullet points
  let reasoning: string;
  if (typeof ai.reasoning === "object" && ai.reasoning !== null) {
    const lines: string[] = [];
    for (const s of ai.reasoning.strengths ?? []) lines.push(`✓ ${s}`);
    for (const w of ai.reasoning.weaknesses ?? []) lines.push(`✗ ${w}`);
    if (ai.reasoning.crm_alert && ai.reasoning.crm_alert !== "null") lines.push(`⚠ ${ai.reasoning.crm_alert}`);
    reasoning = lines.join("\n");
  } else {
    reasoning = ai.reasoning ?? "";
  }
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
      qualification: result.qualification ?? null,
      scored_at: new Date().toISOString(),
    }, { onConflict: "deal_id" });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[deals/score] ERROR:", e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
