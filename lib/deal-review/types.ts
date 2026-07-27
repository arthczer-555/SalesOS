// ────────────────────────────────────────────────────────────────────────
// Contrat de données du Deal Review (admin). Partagé entre la route API
// (/api/admin/deal-review) et l'UI (/admin/deal-review).
//
// Convention assumée partout : une valeur absente vaut `null`, jamais 0.
// Le montant HubSpot est vide sur une partie du pipeline, on affiche "—"
// plutôt que d'inventer un zéro qui fausserait les totaux.
// ────────────────────────────────────────────────────────────────────────

/** Une ligne de deal ouvert du pipeline sales. */
export type DealRow = {
  id: string;
  dealname: string;

  stageId: string;
  stageLabel: string;
  stageOrder: number;
  isNurture: boolean;

  amount: number | null;

  ownerId: string;
  ownerName: string;
  ownerAccent: string;

  /** Score IA /100 (deal_scores.score.total), null si le deal n'a jamais été scoré. */
  score: number | null;
  /** Nb de propriétés de qualification HubSpot remplies (0-5). */
  reliability: number | null;

  /** num_contacted_notes : calls, emails, meetings, LinkedIn, SMS, WhatsApp loggés. */
  touchPoints: number;
  /** num_notes : idem + notes et tâches. Contexte de tooltip. */
  salesActivities: number;
  numContacts: number;

  /** Meetings Claap analysés (sales_coach_analyses, status done). */
  claapCalls: number;
  claapAvgScore: number | null;

  daysInStage: number | null;
  daysSinceContact: number | null;
  isStalled: boolean;
  nextActivityAt: string | null;
  nextStep: string | null;

  createdate: string | null;
  closedate: string | null;
};

/**
 * Une ligne de deal clos sur la période. Sert à rendre le win rate et les
 * "touches to close" cliquables : un clic sur le KPI doit pouvoir lister les
 * deals qui le composent, pas seulement afficher un pourcentage.
 */
export type ClosedDealRow = {
  id: string;
  dealname: string;
  won: boolean;

  ownerId: string;
  ownerName: string;
  ownerAccent: string;

  amount: number | null;
  closedate: string | null;
  createdate: string | null;
  daysToClose: number | null;
  touchPoints: number | null;
};

/**
 * Repère de touch points par étape. `medianTouchPoints` est volontairement
 * `null` quand l'étape compte moins de MIN_STAGE_SAMPLE deals ouverts : une
 * médiane sur 1 ou 2 deals ne veut rien dire et induirait en erreur.
 */
export type StageBenchmark = {
  stageId: string;
  stageLabel: string;
  order: number;
  openDeals: number;
  pipeline: number;
  medianTouchPoints: number | null;
};

/** Agrégat par owner de deal (AE du roster ou non). */
export type RepSummary = {
  ownerId: string;
  ownerName: string;
  accent: string;
  /** true si l'owner est un user marqué Sales (users.is_sales). */
  isSalesUser: boolean;

  openDeals: number;
  pipeline: number;
  medianTouchPoints: number | null;
  stalledCount: number;
  noNextActivityCount: number;
  staleContactCount: number;

  closedWon: number;
  closedLost: number;
  /** 0-100, null si aucun deal clos sur la période. */
  winRate: number | null;
  /** days_to_close médian des deals gagnés de la période. */
  medianDaysToClose: number | null;
  /** touch points médians des deals gagnés de la période. */
  medianTouchesToClose: number | null;
};

export type DealReviewTotals = {
  openDeals: number;
  pipeline: number;
  medianTouchPoints: number | null;
  stalledCount: number;
  noNextActivityCount: number;
  staleContactCount: number;
  closedWon: number;
  closedLost: number;
  winRate: number | null;
};

/** Repère global "combien de touches faut-il pour closer". */
export type WonBenchmark = {
  medianTouchPoints: number | null;
  medianDaysToClose: number | null;
  /** Taille de l'échantillon (deals gagnés sur la période). */
  sample: number;
  /** Contre-repère : touch points médians des deals perdus. */
  lostMedianTouchPoints: number | null;
  lostSample: number;
};

export type DealReviewResponse = {
  /** Deals ouverts du pipeline sales, nurture inclus (filtré côté client). */
  deals: DealRow[];
  /** Deals clos du pipeline sales depuis `periodStart` (gagnés et perdus). */
  closedDeals: ClosedDealRow[];
  stages: StageBenchmark[];
  reps: RepSummary[];
  /** Agrégats globaux, calculés hors nurture. */
  totals: DealReviewTotals;
  wonBenchmark: WonBenchmark;
  /** Début de la période prise en compte pour les deals clos (ISO day). */
  periodStart: string;
  /** Sources en échec ("deals_open", "deals_closed", "scores", "claap"…). */
  warnings: string[];
  fetchedAt: string;
};

/** Nb minimum de deals ouverts pour qu'une médiane d'étape soit publiée. */
export const MIN_STAGE_SAMPLE = 5;

/** Nb minimum de deals clos pour publier un win rate par owner. */
export const MIN_CLOSED_SAMPLE = 5;

/** Nb minimum de deals gagnés pour publier un cycle / des touches to close. */
export const MIN_WON_SAMPLE = 3;

/** Au-delà, un deal est considéré sans contact récent (aligné sur healthIndicator). */
export const STALE_CONTACT_DAYS = 14;
