// Deal scoring algorithm based on 3 Coachello models (Generic, Human Coaching, AI Coaching)

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { logUsage } from "./log-usage";

export const DEFAULT_SCORE_MODEL = "claude-haiku-4-5-20251001";

export type DealModel = "generic" | "human_coaching" | "ai_coaching";

export interface ScoreComponent {
  name: string;
  earned: number;
  max: number;
  filled: boolean;
}

export interface DealScore {
  total: number;
  components: ScoreComponent[];
  reliability: 0 | 1 | 2 | 3 | 4 | 5;
}

export const KEY_EVENT_TYPES = [
  "devis",
  "contrat",
  "echange_important",
  "objection",
  "relance",
  "decision",
  "reunion",
  "autre",
] as const;
export type DealKeyEventType = (typeof KEY_EVENT_TYPES)[number];
export interface DealKeyEvent {
  date: string;
  label: string;
  type: DealKeyEventType;
  description: string;
}

// ─── Authority scoring ────────────────────────────────────────────────────────
const AUTHORITY_VALUES: Record<string, number> = {
  "executive_sponsor": 20,
  "senior_decision_maker": 14,
  "middle_manager": 8,
  "champion_no_authority": 4,
  "unknown": 0,
};

// Max points per model
const AUTHORITY_MAX: Record<DealModel, number> = {
  generic: 20,
  human_coaching: 20,
  ai_coaching: 15,
};

function scoreAuthority(value: string | null | undefined, model: DealModel): number {
  if (!value) return 0;
  const base = AUTHORITY_VALUES[value] ?? 0;
  const max = AUTHORITY_MAX[model];
  return Math.round((base / 20) * max);
}

// ─── Budget scoring ───────────────────────────────────────────────────────────
const BUDGET_VALUES: Record<string, number> = {
  "confirmed_approved": 15,
  "identified_not_approved": 10,
  "budget_discussion": 6,
  "no_budget": 0,
};

const BUDGET_MAX: Record<DealModel, number> = {
  generic: 15,
  human_coaching: 15,
  ai_coaching: 15,
};

function scoreBudget(value: string | null | undefined, model: DealModel): number {
  if (!value) return 0;
  const base = BUDGET_VALUES[value] ?? 0;
  const max = BUDGET_MAX[model];
  return Math.round((base / 15) * max);
}

// ─── Timeline scoring ─────────────────────────────────────────────────────────
const TIMELINE_VALUES: Record<string, number> = {
  "within_30_days": 10,
  "within_90_days": 7,
  "within_6_months": 4,
  "over_6_months": 1,
  "unknown": 0,
};

const TIMELINE_MAX: Record<DealModel, number> = {
  generic: 10,
  human_coaching: 10,
  ai_coaching: 10,
};

function scoreTimeline(value: string | null | undefined, model: DealModel): number {
  if (!value) return 0;
  const base = TIMELINE_VALUES[value] ?? 0;
  const max = TIMELINE_MAX[model];
  return Math.round((base / 10) * max);
}

// ─── Business Need scoring ────────────────────────────────────────────────────
const NEED_VALUES: Record<string, number> = {
  "critical_pain": 15,
  "significant_need": 9,
  "nice_to_have": 4,
  "exploratory": 1,
  "unknown": 0,
};

const NEED_MAX: Record<DealModel, number> = {
  generic: 15,
  human_coaching: 15,
  ai_coaching: 15,
};

function scoreBusinessNeed(value: string | null | undefined, model: DealModel): number {
  if (!value) return 0;
  const base = NEED_VALUES[value] ?? 0;
  const max = NEED_MAX[model];
  return Math.round((base / 15) * max);
}

// ─── Strategic Fit scoring ────────────────────────────────────────────────────
const STRATEGIC_VALUES: Record<string, number> = {
  "perfect_fit": 5,
  "good_fit": 4,
  "partial_fit": 2,
  "poor_fit": 1,
  "unknown": 0,
};

function scoreStrategicFit(value: string | null | undefined): number {
  if (!value) return 0;
  return STRATEGIC_VALUES[value] ?? 0;
}

// ─── Competition scoring ─────────────────────────────────────────────────────
const COMPETITION_VALUES: Record<string, number> = {
  "sole_provider": 10,
  "no_mention": 7,
  "probable_competition": 3,
  "confirmed_competition": 0,
  "unknown": 7,
};

const COMPETITION_MAX: Record<DealModel, number> = {
  generic: 10,
  human_coaching: 10,
  ai_coaching: 10,
};

function scoreCompetition(value: string | null | undefined): number {
  if (!value) return 7; // default: no mention
  return COMPETITION_VALUES[value] ?? 7;
}

// ─── Engagement (auto-calculated — basic fallback, real scoring done by Claude) ─
const ENGAGEMENT_MAX: Record<DealModel, number> = {
  generic: 25,
  human_coaching: 25,
  ai_coaching: 25,
};

export function calcEngagement(
  lastContactedMs: number | null,
  lastModifiedMs: number | null,
  model: DealModel
): number {
  const max = ENGAGEMENT_MAX[model];
  const ref = lastContactedMs ?? lastModifiedMs;
  const daysSince = ref ? (Date.now() - ref) / 864e5 : 999;

  // Basic recency-only fallback — the real engagement scoring is done by Claude
  // with volume, variety, bilateral signals, multi-threading, and stagnation
  let ratio: number;
  if (daysSince > 30) ratio = 0;
  else if (daysSince > 15) ratio = 0.15;
  else if (daysSince > 7) ratio = 0.3;
  else ratio = 0.4; // Max 40% from recency alone — need volume+variety for more

  return Math.round(ratio * max);
}

// ─── Model detection ──────────────────────────────────────────────────────────
export function detectModel(dealType: string | null | undefined): DealModel {
  if (dealType === "human_coaching") return "human_coaching";
  if (dealType === "ai_coaching") return "ai_coaching";
  return "generic";
}

// ─── Dimension labels per model ───────────────────────────────────────────────
const DIMENSION_NAMES: Record<DealModel, string[]> = {
  generic: ["Authority & Buying Group", "Budget Clarity", "Timeline", "Business Need", "Engagement & Momentum", "Strategic Fit", "Compétition"],
  human_coaching: ["Authority & Governance", "Budget", "Timeline", "Business Need", "Engagement & Momentum", "Strategic Fit", "Compétition"],
  ai_coaching: ["Authority", "Budget", "Timeline", "Business Urgency", "Engagement & Momentum", "Strategic AI Fit", "Compétition"],
};

// ─── Main scoring function ────────────────────────────────────────────────────
export interface DealForScoring {
  authority_status?: string | null;
  budget_status?: string | null;
  decision_timeline?: string | null;
  business_need_level?: string | null;
  strategic_fit?: string | null;
  competition_status?: string | null;
  deal_type?: string | null;
  notes_last_contacted?: string | null;
  hs_lastmodifieddate?: string | null;
}

export function calcScore(deal: DealForScoring): DealScore {
  const model = detectModel(deal.deal_type);
  const names = DIMENSION_NAMES[model];

  const lastContactedMs = deal.notes_last_contacted ? new Date(deal.notes_last_contacted).getTime() : null;
  const lastModifiedMs = deal.hs_lastmodifieddate ? new Date(deal.hs_lastmodifieddate).getTime() : null;

  const authorityEarned = scoreAuthority(deal.authority_status, model);
  const budgetEarned = scoreBudget(deal.budget_status, model);
  const timelineEarned = scoreTimeline(deal.decision_timeline, model);
  const needEarned = scoreBusinessNeed(deal.business_need_level, model);
  const engagementEarned = calcEngagement(lastContactedMs, lastModifiedMs, model);
  const strategicEarned = scoreStrategicFit(deal.strategic_fit);
  const competitionEarned = scoreCompetition(deal.competition_status);

  const components: ScoreComponent[] = [
    { name: names[4], earned: engagementEarned, max: ENGAGEMENT_MAX[model], filled: true }, // auto
    { name: names[0], earned: authorityEarned, max: AUTHORITY_MAX[model], filled: !!deal.authority_status },
    { name: names[3], earned: needEarned, max: NEED_MAX[model], filled: !!deal.business_need_level },
    { name: names[1], earned: budgetEarned, max: BUDGET_MAX[model], filled: !!deal.budget_status },
    { name: names[6], earned: competitionEarned, max: COMPETITION_MAX[model], filled: !!deal.competition_status },
    { name: names[2], earned: timelineEarned, max: TIMELINE_MAX[model], filled: !!deal.decision_timeline },
    { name: names[5], earned: strategicEarned, max: 5, filled: !!deal.strategic_fit },
  ];

  const total = components.reduce((sum, c) => sum + c.earned, 0);

  // Reliability = count of non-null custom properties (exclude auto Engagement)
  const filledCount = [
    deal.authority_status,
    deal.budget_status,
    deal.decision_timeline,
    deal.business_need_level,
    deal.strategic_fit,
  ].filter(Boolean).length as 0 | 1 | 2 | 3 | 4 | 5;

  return { total, components, reliability: filledCount };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
export function scoreBadge(total: number): { label: string; color: string; bg: string } {
  if (total >= 75) return { label: "High Priority", color: "#16a34a", bg: "#dcfce7" };
  if (total >= 55) return { label: "Avançable", color: "#ca8a04", bg: "#fef9c3" };
  if (total >= 35) return { label: "Fragile", color: "#ea580c", bg: "#ffedd5" };
  return { label: "À risque", color: "#dc2626", bg: "#fee2e2" };
}

export function reliabilityLabel(n: number): string {
  if (n >= 5) return "Fiable";
  if (n >= 3) return "Partiel";
  if (n >= 1) return "Incomplet";
  return "Non scoré";
}

export function reliabilityColor(n: number): string {
  if (n >= 5) return "#16a34a";
  if (n >= 3) return "#ca8a04";
  if (n >= 1) return "#ea580c";
  return "#9ca3af";
}

export function healthIndicator(closeDateMs: number | null, lastContactedMs: number | null): "green" | "yellow" | "red" {
  const now = Date.now();
  const daysSinceContact = lastContactedMs ? (now - lastContactedMs) / 864e5 : 999;
  const daysToClose = closeDateMs ? (closeDateMs - now) / 864e5 : 999;

  if (closeDateMs && closeDateMs < now) return "red";
  if (daysSinceContact > 14) return "red";
  if (daysToClose <= 14 || daysSinceContact > 7) return "yellow";
  return "green";
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  scoreOneDeal — AI-based scoring, kept here (and not in the API route)   */
/*  so Netlify Functions bundling doesn't drag in `next/server`.            */
/* ─────────────────────────────────────────────────────────────────────── */

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

export async function scoreOneDeal(dealId: string, userId: string | null, claudeModel = DEFAULT_SCORE_MODEL, enableCache = false): Promise<DealScore & { reasoning: string; next_action: string; qualification: Record<string, string | null>; key_events: DealKeyEvent[] }> {
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
- Champ CRM vide → déduis depuis les conversations ET tous les autres champs disponibles (voir EXPLORATION EXHAUSTIVE).
- Si AUCUNE information (aucun signal direct ni indirect après exploration exhaustive) → score 0. Ne donne JAMAIS un score par défaut ou "au milieu" par manque d'info.

=== EXPLORATION EXHAUSTIVE DES CHAMPS ===

Avant de donner 0 sur une dimension, tu DOIS avoir cherché dans TOUS les champs fournis :
- Champs CRM dédiés (authority_status, budget_status, decision_timeline, business_need_level, strategic_fit)
- dealname (peut contenir des indices : "RFP X", "Renouvellement Y", "POC Z")
- dealstage (agreement/contract/closedwon = preuve de progression avancée)
- description du deal
- montant (amount), date de clôture (closedate), âge du deal
- Titres de meetings (hs_meeting_title), bodies des meetings et des calls
- Titres de calls (hs_call_title), dispositions, outcomes
- hs_body_preview des engagements
- Contacts associés : noms, jobtitles (indice direct d'authority : DRH, C-level, Manager, …)
- notes_last_contacted

Exemples de déductions indirectes obligatoires :
- Jobtitle "Chief People Officer" parmi les contacts → authority ≥ 14 même sans champ CRM
- Montant renseigné à 50 000€ + closedate dans 45 jours → budget ≥ 6 et timeline ≥ 7
- Dealstage "agreement" ou "contract sent" → tout le monde a validé en amont (voir STAGES AVANCÉS)
- Meeting intitulé "Présentation offre commerciale" → engagement activité confirmée
- Description mentionne "transformation managériale" → strategic_fit ≥ 4

Tu ne peux donner 0 sur une dimension QUE si, après avoir balayé tous ces champs, aucun signal direct ou indirect n'existe. Mentionne alors dans reasoning.weaknesses : "Aucun signal X (tous champs explorés)."

=== STAGES AVANCÉS (agreement / contract / negotiation / closedwon) ===

Quand le dealstage indique un stage très avancé (contient "agreement", "contract", "negotiation", "decision maker", "closedwon", ou équivalent), la progression elle-même est la preuve rétrospective que les étapes amont ont été validées. Applique ces planchers :

- authority ≥ 15 : un contrat/agreement avance = un décisionnaire est identifié et engagé
- budget ≥ 12 : un contrat avance = un budget a été dégagé ou est en cours de validation finale
- timeline ≥ 8 : contrat en cours = calendrier aligné
- business_need ≥ 13 : on ne lance pas un contrat sans besoin validé
- strategic_fit ≥ 3 sauf mismatch évident avec l'offre Coachello
- competition ≥ 6 : si on en est à l'agreement, on est en position forte
- engagement reste fonction de l'activité récente (pas de plancher)

Signale dans reasoning.strengths : "Stage avancé (<nom stage>) — qualification rétrospective."

Cas closedlost : score normalement mais ajoute la raison probable de la perte dans reasoning.weaknesses si identifiable.

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

=== SIGNAUX RFP / APPEL D'OFFRES ===

Un RFP officiel (cahier des charges formel, grille d'évaluation, deadline fournisseur) est un ACCÉLÉRATEUR, pas seulement un signal de concurrence.

Détecte ces étapes dans les échanges (emails, meetings, notes) et additionne dans engagement :
- Dossier RFP reçu / cahier des charges en main           → +3 engagement
- Réponse RFP soumise / proposition envoyée               → +5 engagement
- Shortlist / finaliste / retenu pour oral                → +7 engagement
- Oral / soutenance / présentation finale planifiée       → +8 engagement
Ces bonus restent plafonnés à ${maxes.engagement} (ne double pas avec les meetings déjà comptés dans les signaux classiques).

RÈGLE RFP → BUSINESS_NEED (OBLIGATOIRE) :
Si un RFP officiel est détecté, business_need ≥ 12/${maxes.business_need}. Un RFP prouve qu'il existe un besoin validé, budgété et porté en interne. Ne descends sous 12 que si le RFP est explicitement qualifié d'"exploratoire" ou de "benchmark".

RÈGLE RFP → COMPETITION (nuance) :
RFP multi-fournisseurs = competition basse (3 par défaut). MAIS si shortlist/finaliste atteint, remonte competition à 6/${maxes.competition} minimum — on est en position forte.

Pour chaque étape RFP bonifiée, cite une phrase courte (≤ 15 mots) de l'échange concerné dans reasoning.strengths. Sans citation concrète, pas de bonus.

5. ${names[4]} (0 à ${maxes.engagement} pts) — SCORING TRÈS DUR
Évalue la dynamique RÉELLE du deal à partir de signaux cumulés. Un seul email récent ne vaut PAS 25.
Additionne les signaux suivants :
- Recency (dernier échange < 7j = +4, 7-14j = +2, > 14j = 0)
- Volume (5+ engagements sur 30j = +5, 3-4 = +3, 1-2 = +1, 0 = 0)
- Variété (au moins 2 types d'échange — ex: email + call, call + meeting = +3)
- Bilatéral (au moins 1 réponse/email entrant ou meeting initié par le prospect dans les 30j = +4, sinon 0)
- Multi-threading (2+ contacts/interlocuteurs impliqués = +4, 1 seul = 0)
- Stagnation (deal créé depuis > 60 jours ET aucun changement de stage récent = −5)
- Réceptivité du prospect (analyse du ton dans les emails/meetings entrants) :
  - Ton enthousiaste ("super", "hâte de", "parfait", "exactement ce qu'il nous faut") = +2
  - Prospect répond en < 24h sur 2+ échanges récents = +2
  - Prospect propose lui-même la prochaine étape / relance sans sollicitation = +3
  - Prospect mentionne impliquer des parties prenantes internes ("j'en parle à mon boss") = +2
  - Ton froid / monosyllabique / silence > 7j répété malgré relances = −3
Le max théorique est 20-22 sur ${maxes.engagement}. Avoir ${maxes.engagement} = deal exceptionnellement actif et engagé bilatéralement (signaux classiques + RFP + réceptivité cumulés mais plafonnés).
IMPORTANT : un seul email envoyé sans réponse la semaine dernière = ~5 pts max. Sois TRÈS strict sur les deals early-stage. Pour les deals avancés (RFP, agreement), les bonus momentum et réceptivité peuvent monter l'engagement vers le plafond.

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

=== DICTIONNAIRE FR — MOTS-CLÉS À DÉTECTER PAR DIMENSION ===

AUTHORITY : COMEX, CODIR, C-level, CEO, CHRO, CPO, DG, DRH, VP People, Head of People/L&D/Talent, Directeur Learning/Formation, HRBP, Chief People Officer. Un de ces titres parmi les contacts → authority ≥ 14 même sans autre signal.

BUDGET : "enveloppe", "pré-budgété", "arbitrage DAF", "PO émis", "bon de commande", "ligne budgétaire L&D", "forfait N coachings", "tarif par session". Montant ≥ 20k€ explicite = budget ≥ 10.

TIMELINE : "Q1-Q4 2026", "T1/T2", "rentrée", "budget 2026", "clôture d'exercice", "deadline", "kick-off", "go-live". Date précise + proche (< 90j) = timeline ≥ 7.

BUSINESS NEED — pain points coaching : turnover cadres, désengagement, managers promus sans formation, transformation culturelle, post-M&A, nouveau DG/DRH, restructuration, ENPS en baisse, succession planning, pivot stratégique. ≥ 1 pain point articulé → business_need ≥ 9.

STRATEGIC FIT : "développement du leadership", "coaching dirigeants/managers", "parcours managérial", "onboarding dirigeants", "executive coaching", "coaching d'équipe", "codev", "feedback 360". Un de ces termes → strategic_fit ≥ 4.

COMPETITION : BetterUp, CoachHub, Ezra, MentorCity, MoovOne, Simundia, Bloom at Work, Nayan, Wemanity, 15Five, Lattice, Leapsome. Mention explicite = competition 0-3.

=== INSTRUCTIONS ===
- Sois exigeant sur les deals early-stage (discovery, qualification) : une dimension sans aucun signal même indirect = 0.
- Pour les deals avancés (stage agreement/contract/negotiation/closedwon, RFP soumis, shortlist, closing), les signaux de momentum et d'aboutissement COMPENSENT l'absence de data dure. Un deal qui progresse concrètement mérite son score même si les champs CRM dédiés ne sont pas remplis.
- AVANT de donner 0 sur une dimension, tu DOIS avoir balayé tous les champs (voir EXPLORATION EXHAUSTIVE). 0 = absence totale de signal direct ET indirect, pas "champ CRM vide".
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
  },
  "key_events": [
    { "date": "YYYY-MM-DD", "label": "Titre court (ex: Devis envoyé)", "type": "devis|contrat|echange_important|objection|relance|decision|reunion|autre", "description": "1 phrase de contexte" }
  ]
}

key_events : extrais les moments DATÉS qui retracent le parcours du deal (devis/proposition envoyé, échange ou réunion important, objection majeure, relance décisive, décision ou engagement du prospect…). Convertis les dates DD/MM/YYYY du contexte en YYYY-MM-DD. N'invente JAMAIS de date : si un événement ne peut pas être daté depuis le contexte, ne l'inclus pas. Renvoie un tableau vide s'il n'y a aucun événement datable.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: claudeModel,
    max_tokens: 1500,
    system: enableCache
      ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
      : systemPrompt,
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

  const key_events: DealKeyEvent[] = Array.isArray(ai.key_events)
    ? ai.key_events
        .map((e: { date?: string; label?: string; type?: string; description?: string }) => {
          const date = typeof e?.date === "string" ? e.date.trim() : "";
          const label = typeof e?.label === "string" ? e.label.trim() : "";
          if (!date || !label || Number.isNaN(new Date(date).getTime())) return null;
          const type = KEY_EVENT_TYPES.includes(e?.type as DealKeyEventType)
            ? (e!.type as DealKeyEventType)
            : "autre";
          return { date, label, type, description: e?.description?.trim() ?? "" };
        })
        .filter((e: DealKeyEvent | null): e is DealKeyEvent => e !== null)
    : [];

  return { ...score, reasoning, next_action, qualification, key_events };
}
