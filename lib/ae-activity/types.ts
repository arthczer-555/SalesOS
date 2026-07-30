// ────────────────────────────────────────────────────────────────────────
// Types partagés du dashboard "AE Sales Activity".
//
// Contrat entre la couche serveur (fetch HubSpot + Sheet + Claap + Slack +
// Sales Coach → build-snapshot) et l'UI. Le payload JSONB d'une row
// `ae_activity_snapshots` EST un RepSnapshot.
// ────────────────────────────────────────────────────────────────────────

// Granularités du sélecteur UI.
export type Granularity = "week" | "month" | "quarter" | "semester" | "year";

export const GRANULARITIES: Granularity[] = ["week", "month", "quarter", "semester", "year"];

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  semester: "Semester",
  year: "Yearly",
};

// Durée minimale d'un appel sortant pour compter comme une vraie conversation.
// La disposition HubSpot "Connected" est posée par défaut par le dialer (on
// trouve des appels de 2s marqués Connected), elle ne discrimine rien : c'est
// la durée qui fait foi.
export const CONNECTED_CALL_MIN_MS = 60_000;

// Un bucket temporel d'activité (tous les compteurs sont sommés sur la période).
export type ActivityBucket = {
  key: string; // début de période ISO (YYYY-MM-DD) ou "2026-H1" pour le semestre
  label: string; // libellé d'affichage ("Jan 26", "Q1 2026", "H1 2026"…)
  outboundCalls: number;
  inboundCalls: number;
  connectedCalls: number; // appels sortants ayant duré >= CONNECTED_CALL_MIN_MS
  connectedColdCalls: number; // idem, restreint aux cold calls (dénominateur du taux affiché)
  callsOnDeal: number; // appels sortants vers un contact qui a au moins un deal
  callsCold: number; // appels sortants vers un contact sans deal (cold call)
  emailsOut: number; // emails sortants (artefacts de calendrier exclus)
  emailsCold: number; // sortants vers un contact sans deal = prospection
  emailsOnDeal: number; // sortants vers un contact qui a déjà un deal
  meetingsScheduled: number;
  meetingsInboundSourced: number; // meeting rattaché à un lead marketing
  meetingsSelfSourced: number;
  meetingsHeld: number; // Claap (meetings enregistrés avec prospect)
  selfBookedSlack: number; // Slack #new-meetings (auto-déclarés)
  dealsOpened: number;
  dealsOpenedInbound: number; // deal rattaché à un lead marketing
  leadsInbound: number; // leads marketing validés attribués au rep (par validated_at)
  closedWon: number;
  closedLost: number;
  dispositions: Record<string, number>; // issues d'appels sortants (label → count)
};

export type FunnelStage = { id: string; label: string; count: number };

export type LostReason = { reason: string; count: number };

// Revenu + objectifs tirés du Sheet Drive, par rep. Montants en EUR.
export type QuarterAmount = {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  target: number | null;
  billed: number | null;
};

// Un compte facturé sur l'année (bloc "DÉTAIL DES DEALS" du Sheet).
export type AccountRevenue = { company: string; billed: number };

// Un flux de revenu porté par un rep (New en tant qu'AE, Renew en tant qu'AM,
// Renew en tant que CSM). Même forme dans les trois cas.
export type RevenueStream = {
  target: number | null;
  billed: number | null;
  quarters: QuarterAmount[]; // Q1..Q4
  accounts: AccountRevenue[]; // détail des comptes, montant décroissant
};

export function emptyRevenueStream(): RevenueStream {
  return { target: null, billed: null, quarters: [], accounts: [] };
}

export type RevenuePerf = {
  matched: boolean; // le rep a-t-il été retrouvé dans le Sheet ?
  sheetName: string | null; // le prénom/label matché dans le Sheet
  newBiz: RevenueStream; // onglet "Suivi New" (rôle AE)
  renew: RevenueStream; // onglet "Suivi Renew" (rôle AM)
  csmRenew: RevenueStream; // onglet "Suivi CSM" (rôle CSM)
};

// Note moyenne Sales Coach (score_global /10) d'un mois donné.
export type MonthlyScore = {
  month: string; // "YYYY-MM"
  avg: number; // moyenne arrondie à 1 décimale
  count: number; // nb de meetings notés (pour juger la fiabilité de la moyenne)
};

export type Coaching = {
  // UNE recommandation de 1-2 phrases, portant sur le point qui revient le plus
  // souvent dans Sales Coach. Remplace les 3-5 puces de l'ancien bloc coaching :
  // un rep applique une consigne, pas cinq.
  recommendation: string | null;
  meetingsAnalyzed: number; // nb de meetings Claap analysés pris en compte
  generatedAt: string | null; // ISO
  scoreByMonth: MonthlyScore[]; // note Claap par mois, croissant
};

// Un meeting déclaré dans Slack #new-meetings (1 message top-level = 1 meeting).
// Le texte est conservé pour le drill-down "quels meetings ?" côté UI.
export type SlackBookedMeeting = {
  day: string; // "YYYY-MM-DD"
  ts: string; // timestamp Slack du message
  text: string; // contenu du message, tronqué
};

// Snapshot complet d'un rep = payload JSONB d'une row ae_activity_snapshots.
export type RepSnapshot = {
  repOwnerId: string;
  repName: string;
  repEmail: string | null;
  roles: string[]; // SalesRole[] — sépare les CSM des AE dans les vues manager
  accent: string; // couleur d'accent (repAccent)
  byGranularity: Record<Granularity, ActivityBucket[]>;
  funnel: FunnelStage[]; // funnel des deals (deals créés par étape actuelle)
  leadsFunnel: FunnelStage[]; // funnel des leads marketing (validés → deal → étapes → won)
  lostReasons: LostReason[];
  revenue: RevenuePerf;
  coaching: Coaching;
  slackMeetings: SlackBookedMeeting[]; // détail des meetings déclarés dans Slack
  dataWarnings: string[]; // métriques HubSpot revenues vides, etc.
};

// Réponse de l'API GET /api/admin/ae-activity.
export type AeActivityMeta = {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  repCount: number | null;
};

export type AeActivityResponse = {
  reps: RepSnapshot[];
  refreshedAt: string | null; // MAX(refreshed_at) des rows rep
  meta: AeActivityMeta;
};

// Réponse de GET /api/me/dashboard : le snapshot du seul utilisateur connecté,
// plus ce qu'il faut pour expliquer un dashboard vide (pas sales, pas d'owner
// HubSpot, ou snapshot pas encore calculé).
export type MeDashboardResponse = {
  rep: RepSnapshot | null;
  roles: string[]; // SalesRole[], typé large pour éviter un cycle d'import
  isSales: boolean;
  hasOwnerId: boolean;
  refreshedAt: string | null;
};
