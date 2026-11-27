// Modèle des pipelines de deals HubSpot, PAR IDENTIFIANTS (bascule du 30/11/2026).
//
// Source de vérité unique : aucun code ne doit plus reconnaître un pipeline ou
// une étape par son libellé (Gaëlle renomme les étapes à la bascule, et un
// test sur "disco" ou "won" casse en silence). Les libellés ne servent qu'à
// l'affichage : getStageLabels() les lit en direct, avec un libellé de secours
// ici pour les étapes que HubSpot ne renverrait plus.
//
// Deux pipelines pour la vente, puis le pipeline Customer Success :
//   Prospection (les "leads") : R1 scheduled -> Scoping (SQL) -> Opportunity low / medium / high
//   Sales (les "deals")       : Qualified opportunity -> Proposal -> ... -> Won / Lost
// Le workflow HubSpot [PIPE] 01 range une carte de Prospection selon le score
// écrit par le SalesOS (moins de 40 low, 40-59 medium, 60-79 high, 80 et plus
// = Qualified opportunity du pipeline Sales).

import { hubspotFetch } from "@/lib/hubspot";

export const PIPELINE_IDS = {
  prospection: "4371889393",
  sales: "default",
  customerSuccess: "769590794",
} as const;

export type PipelineKey = keyof typeof PIPELINE_IDS;

export type StageRole =
  | "r1_scheduled"
  | "scoping"
  | "opportunity"
  | "qualified"
  | "business_case"
  | "proposal"
  | "negotiation"
  | "contracting"
  | "nurture"
  | "customer_success"
  | "won"
  | "lost";

export type ScoreBand = "low" | "medium" | "high" | "qualified";

export interface StageDef {
  id: string;
  pipeline: PipelineKey;
  role: StageRole;
  /** Libellé de secours (affichage seulement), si HubSpot ne renvoie plus l'étape. */
  label: string;
  closed: boolean;
  /** Bande portée par une colonne Opportunity du pipeline Prospection. */
  band?: Exclude<ScoreBand, "qualified">;
  /**
   * required : indispensable au modèle du 30/11 (assertPipelineModel échoue s'il manque).
   * optional : étape de l'ancien modèle, ou dont le sort dépend du renommage de Gaëlle
   * (question 1 du plan) : son absence est signalée, pas bloquante.
   */
  status: "required" | "optional";
}

export const STAGES: readonly StageDef[] = [
  // ── Prospection ──
  { id: "6476869839", pipeline: "prospection", role: "r1_scheduled", label: "R1 scheduled", closed: false, status: "required" },
  { id: "6476869840", pipeline: "prospection", role: "scoping", label: "Scoping (SQL)", closed: false, status: "required" },
  { id: "6476869841", pipeline: "prospection", role: "opportunity", band: "low", label: "Opportunity low", closed: false, status: "required" },
  { id: "6476869842", pipeline: "prospection", role: "opportunity", band: "medium", label: "Opportunity medium", closed: false, status: "required" },
  { id: "6476869843", pipeline: "prospection", role: "opportunity", band: "high", label: "Opportunity high", closed: false, status: "required" },
  { id: "6476869844", pipeline: "prospection", role: "lost", label: "Closed lost", closed: true, status: "required" },
  // ── Sales ──
  // Les deux premières étapes appartiennent à l'ancien modèle (avant le 30/11) :
  // elles gardent leur rôle pour que les funnels restent continus.
  { id: "174474867", pipeline: "sales", role: "r1_scheduled", label: "Discovery Meeting scheduled", closed: false, status: "optional" },
  { id: "6169316582", pipeline: "sales", role: "scoping", label: "Scoping", closed: false, status: "optional" },
  { id: "174474868", pipeline: "sales", role: "qualified", label: "Qualified opportunity", closed: false, status: "required" },
  { id: "174474869", pipeline: "sales", role: "business_case", label: "Business case & stakeholders validated", closed: false, status: "optional" },
  { id: "174474870", pipeline: "sales", role: "proposal", label: "Proposal & negotiation", closed: false, status: "required" },
  { id: "174474871", pipeline: "sales", role: "negotiation", label: "Negotiation / Decision-Maker Involvement", closed: false, status: "optional" },
  { id: "986464015", pipeline: "sales", role: "contracting", label: "Agreement / Contracting", closed: false, status: "optional" },
  { id: "1090646192", pipeline: "sales", role: "nurture", label: "To nurture", closed: false, status: "optional" },
  { id: "closedwon", pipeline: "sales", role: "won", label: "Closed won", closed: true, status: "required" },
  { id: "closedlost", pipeline: "sales", role: "lost", label: "Closed lost", closed: true, status: "required" },
  // ── Customer Success ── (un deal qui y entre a été gagné)
  { id: "1122561062", pipeline: "customerSuccess", role: "customer_success", label: "Passation Sales CS", closed: false, status: "optional" },
  { id: "1122561063", pipeline: "customerSuccess", role: "customer_success", label: "Onboarding en cours", closed: false, status: "optional" },
  { id: "1122561064", pipeline: "customerSuccess", role: "customer_success", label: "Onboarding terminé", closed: false, status: "optional" },
  { id: "1122561065", pipeline: "customerSuccess", role: "customer_success", label: "Suivi régulier", closed: false, status: "optional" },
  { id: "1122561066", pipeline: "customerSuccess", role: "customer_success", label: "Alertes / risques", closed: false, status: "optional" },
  { id: "1122561067", pipeline: "customerSuccess", role: "customer_success", label: "Préparation renouvellement", closed: false, status: "optional" },
  { id: "1122561068", pipeline: "customerSuccess", role: "won", label: "Renouvelé", closed: true, status: "required" },
  { id: "1122133768", pipeline: "customerSuccess", role: "lost", label: "Non-renouvelé / Churn", closed: true, status: "required" },
];

const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

export const STAGE_IDS = {
  r1Scheduled: "6476869839",
  scoping: "6476869840",
  opportunityLow: "6476869841",
  opportunityMedium: "6476869842",
  opportunityHigh: "6476869843",
  prospectionLost: "6476869844",
  qualified: "174474868",
  proposal: "174474870",
  salesWon: "closedwon",
  salesLost: "closedlost",
} as const;

/** Étapes fermées des trois pipelines : seules celles-ci intéressent le webhook HubSpot. */
export const CLOSED_STAGE_IDS: ReadonlySet<string> = new Set(STAGES.filter((s) => s.closed).map((s) => s.id));

/** Pipelines de la vente (Prospection + Sales) : périmètre du score et des boards. */
export const SALES_MOTION_PIPELINE_IDS: readonly string[] = [PIPELINE_IDS.prospection, PIPELINE_IDS.sales];
/** Seul le pipeline Sales compte dans le forecast. */
export const FORECAST_PIPELINE_IDS: readonly string[] = [PIPELINE_IDS.sales];

/** Préfixe obligatoire des cartes de test (consigne de Gaëlle : "utilise juste le mot TEST"). */
export const TEST_DEAL_PREFIX = "TEST - ";

/**
 * Carte de test : "TEST - ..." (créées par CoachelloHQ), "TEST ..." et "TEST2 ..."
 * (jeux de test des workflows de Gaëlle, 25 et 26/11). Seules ces cartes sont
 * écrites quand un réglage est en mode test. Majuscules exigées : "test" seul
 * (un vieux deal gagné porte ce nom) n'en est pas une.
 */
export function isTestDealName(name: string | null | undefined): boolean {
  const n = name ?? "";
  return n.startsWith(TEST_DEAL_PREFIX) || /^TEST2?\b/.test(n);
}

export function stageDef(stageId: string | null | undefined): StageDef | null {
  return stageId ? STAGE_BY_ID.get(stageId) ?? null : null;
}

export function stageRole(stageId: string | null | undefined): StageRole | null {
  return stageDef(stageId)?.role ?? null;
}

export function pipelineKeyOf(pipelineId: string | null | undefined): PipelineKey | null {
  for (const [key, id] of Object.entries(PIPELINE_IDS) as [PipelineKey, string][]) {
    if (id === pipelineId) return key;
  }
  return null;
}

export const isProspectionPipeline = (pipelineId: string | null | undefined) => pipelineId === PIPELINE_IDS.prospection;
export const isSalesPipeline = (pipelineId: string | null | undefined) => pipelineId === PIPELINE_IDS.sales;
export const isCustomerSuccessPipelineId = (pipelineId: string | null | undefined) => pipelineId === PIPELINE_IDS.customerSuccess;
export const isSalesMotionPipeline = (pipelineId: string | null | undefined) =>
  !!pipelineId && SALES_MOTION_PIPELINE_IDS.includes(pipelineId);

export const isLostStage = (stageId: string | null | undefined) => stageRole(stageId) === "lost";
export const isWonStage = (stageId: string | null | undefined) => stageRole(stageId) === "won";
export const isClosedStage = (stageId: string | null | undefined) => !!stageId && CLOSED_STAGE_IDS.has(stageId);
export const isNurtureStage = (stageId: string | null | undefined) => stageRole(stageId) === "nurture";
export const isR1ScheduledStage = (stageId: string | null | undefined) => stageId === STAGE_IDS.r1Scheduled;

/**
 * Deal gagné : hs_is_closed_won, ou passé dans le pipeline Customer Success
 * (HubSpot y remet hs_is_closed_won à false alors que le deal a été gagné).
 */
export function isWonDealById(deal: { hs_is_closed_won?: boolean | string | null; pipeline?: string | null }): boolean {
  const won = deal.hs_is_closed_won === true || deal.hs_is_closed_won === "true";
  return won || isCustomerSuccessPipelineId(deal.pipeline);
}

// ── Score et bandes ─────────────────────────────────────────────────────────

/** Seuils du workflow [PIPE] 01, définis une seule fois. */
export const SCORE_THRESHOLDS = { medium: 40, high: 60, qualified: 80 } as const;

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_THRESHOLDS.qualified) return "qualified";
  if (score >= SCORE_THRESHOLDS.high) return "high";
  if (score >= SCORE_THRESHOLDS.medium) return "medium";
  return "low";
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  qualified: "Qualified",
};

export interface EnrollmentInput {
  pipeline?: string | null;
  dealstage?: string | null;
  forced_move?: string | boolean | null;
  sale_type?: string | null;
}

export type EnrollmentCheck =
  | { enrollable: true }
  | { enrollable: false; reason: "not_prospection" | "r1_scheduled" | "closed" | "forced_move" | "rfp" | "missing_sale_type" | "missing_forced_move" | "unknown_stage" };

/**
 * Le workflow [PIPE] 01 rangera-t-il cette carte à la prochaine écriture du
 * score ? Mêmes conditions que son enrôlement : pipeline Prospection, étape
 * Scoping ou Opportunity, forced_move faux, sale_type différent de rfp. Ses
 * filtres excluent aujourd'hui les cartes où ces deux champs sont VIDES
 * (question 2 du plan) : une carte qui ne les porte pas est signalée.
 */
export function isEnrollableByScoreWorkflow(deal: EnrollmentInput): EnrollmentCheck {
  if (!isProspectionPipeline(deal.pipeline)) return { enrollable: false, reason: "not_prospection" };
  const role = stageRole(deal.dealstage);
  if (!role) return { enrollable: false, reason: "unknown_stage" };
  if (role === "lost") return { enrollable: false, reason: "closed" };
  if (role === "r1_scheduled") return { enrollable: false, reason: "r1_scheduled" };
  const forced = deal.forced_move;
  if (forced === true || forced === "true") return { enrollable: false, reason: "forced_move" };
  if (forced === null || forced === undefined || forced === "") return { enrollable: false, reason: "missing_forced_move" };
  if (deal.sale_type === "rfp") return { enrollable: false, reason: "rfp" };
  if (!deal.sale_type) return { enrollable: false, reason: "missing_sale_type" };
  return { enrollable: true };
}

export const ENROLLMENT_REASON_LABELS: Record<Exclude<EnrollmentCheck, { enrollable: true }>["reason"], string> = {
  not_prospection: "already in the Sales pipeline",
  r1_scheduled: "still in R1 scheduled",
  closed: "the card is closed",
  forced_move: "forced move",
  rfp: "RFP",
  missing_sale_type: "Sale type is empty: the workflow skips it unless its filter includes empty values",
  missing_forced_move: "Forced move is empty: the workflow skips it unless its filter includes empty values",
  unknown_stage: "unknown stage",
};

// ── Libellés en direct (affichage seulement) ────────────────────────────────

interface RawPipeline {
  id: string;
  label: string;
  stages?: { id: string; label: string; displayOrder?: number; metadata?: { isClosed?: string; probability?: string } }[];
}

let labelCache: { at: number; pipelines: RawPipeline[] } | null = null;
const LABEL_TTL_MS = 10 * 60 * 1000;

async function fetchPipelines(force = false): Promise<RawPipeline[]> {
  if (!force && labelCache && Date.now() - labelCache.at < LABEL_TTL_MS) return labelCache.pipelines;
  const res = await hubspotFetch<{ results?: RawPipeline[] }>("/crm/v3/pipelines/deals");
  const pipelines = res.results ?? [];
  labelCache = { at: Date.now(), pipelines };
  return pipelines;
}

/**
 * Libellés d'étape et de pipeline, lus en direct (cache 10 min). En cas
 * d'échec HubSpot, les libellés de secours du modèle : l'affichage ne casse
 * jamais, et aucune décision ne dépend de ces libellés.
 */
export async function getStageLabels(): Promise<{ stages: Record<string, string>; pipelines: Record<string, string> }> {
  const stages: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));
  const pipelines: Record<string, string> = { [PIPELINE_IDS.prospection]: "Prospection", [PIPELINE_IDS.sales]: "Sales Pipeline", [PIPELINE_IDS.customerSuccess]: "Customer Success" };
  try {
    for (const p of await fetchPipelines()) {
      pipelines[p.id] = p.label;
      for (const s of p.stages ?? []) stages[s.id] = s.label.trim();
    }
  } catch (e) {
    console.warn("[pipeline-model] live labels unavailable, using fallbacks:", e instanceof Error ? e.message : e);
  }
  return { stages, pipelines };
}

export interface PipelineModelReport {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
  wrongPipeline: string[];
  unknownClosed: string[];
  unknownOpen: string[];
}

/**
 * Contrôle du modèle contre HubSpot (étape 3 de la bascule) : chaque ID requis
 * existe dans le bon pipeline, et aucune étape FERMÉE inconnue n'existe (elle
 * échapperait au tri du webhook). Les ID optionnels absents sont seulement
 * listés : Gaëlle peut supprimer les étapes de l'ancien modèle.
 */
export async function assertPipelineModel(): Promise<PipelineModelReport> {
  const pipelines = await fetchPipelines(true);
  const live = new Map<string, { pipelineId: string; closed: boolean }>();
  for (const p of pipelines) for (const s of p.stages ?? []) live.set(s.id, { pipelineId: p.id, closed: s.metadata?.isClosed === "true" });

  const report: PipelineModelReport = { ok: true, missingRequired: [], missingOptional: [], wrongPipeline: [], unknownClosed: [], unknownOpen: [] };
  for (const s of STAGES) {
    const l = live.get(s.id);
    if (!l) {
      (s.status === "required" ? report.missingRequired : report.missingOptional).push(`${s.id} (${s.label})`);
      continue;
    }
    if (l.pipelineId !== PIPELINE_IDS[s.pipeline]) report.wrongPipeline.push(`${s.id} (${s.label}): in ${l.pipelineId}`);
  }
  const relevant = new Set<string>(Object.values(PIPELINE_IDS));
  for (const [id, l] of live) {
    if (STAGE_BY_ID.has(id) || !relevant.has(l.pipelineId)) continue;
    (l.closed ? report.unknownClosed : report.unknownOpen).push(`${id} (pipeline ${l.pipelineId})`);
  }
  report.ok = report.missingRequired.length === 0 && report.wrongPipeline.length === 0 && report.unknownClosed.length === 0;
  return report;
}
