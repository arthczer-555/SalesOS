// Analyse de perte d'un deal closed lost (fiche /deals, bouton "Analyze the
// loss") : taxonomie fixe des raisons, axes d'exécution, assainissement de la
// sortie IA, faits déterministes (étape de la perte) et métriques par phase.
// Module PUR (pas d'accès réseau ni d'env) : importable côté client et serveur.
//
// Les bornes des phases (Momentum / Stall / Silence) viennent de l'IA, mais
// les chiffres affichés (meetings, réponses, délai de réponse) sont recomptés
// ici depuis HubSpot et Claap : un chiffre affiché doit être vérifiable.

// Liste FIXE, la même pour chaque deal perdu : c'est elle qui permettra
// d'agréger les causes de perte plus tard. Ne pas la modifier sans migrer les
// analyses existantes (les clés sont stockées dans deal_loss_analyses).
export const LOSS_REASONS = [
  { key: "no_budget", label: "No budget" },
  { key: "priority_shift", label: "Priority shift" },
  { key: "competitor", label: "Lost to a competitor" },
  { key: "alternative", label: "Alternative (in-house, other format)" },
  { key: "product_fit", label: "Product fit" },
  { key: "price", label: "Price" },
  { key: "no_access_to_power", label: "No access to power" },
  { key: "champion_left", label: "Champion left or reorg" },
  { key: "timing", label: "Timing" },
  { key: "procurement", label: "Procurement or RFP" },
] as const;

export type LossReasonKey = (typeof LOSS_REASONS)[number]["key"];

export const CONTROLLABLE_LABELS = {
  ours: "On our side",
  mostly_ours: "Mostly on our side",
  shared: "Shared",
  mostly_theirs: "Mostly on their side",
  theirs: "On their side",
} as const;

export type Controllable = keyof typeof CONTROLLABLE_LABELS;

export const EXECUTION_AXES = [
  { key: "qualification", label: "Qualification" },
  { key: "access_to_power", label: "Access to power" },
  { key: "multithreading", label: "Multithreading" },
  { key: "business_case", label: "Business case" },
  { key: "process_control", label: "Process control" },
  { key: "competitive_positioning", label: "Competitive positioning" },
] as const;

export type ExecutionAxisKey = (typeof EXECUTION_AXES)[number]["key"];

export type PhaseKind = "momentum" | "stall" | "silence";

export const PHASE_LABELS: Record<PhaseKind, string> = {
  momentum: "Momentum",
  stall: "Stall",
  silence: "Silence",
};

export type ChainLevel = "symptom" | "cause" | "deeper_cause" | "root_cause";

export const CHAIN_LEVEL_LABELS: Record<ChainLevel, string> = {
  symptom: "Symptom",
  cause: "Cause",
  deeper_cause: "Deeper cause",
  root_cause: "Root cause",
};

export interface PhaseMetrics {
  meetings: number;
  replies: number;
  // Délai médian (jours) entre notre premier message resté sans réponse et la
  // réponse du prospect. null si aucune réponse dans la phase.
  medianReplyDays: number | null;
}

export interface LossPhaseDraft {
  kind: PhaseKind;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  events: { date: string; label: string }[];
}

export interface LossPhase extends LossPhaseDraft {
  metrics: PhaseMetrics;
}

export interface LossExecution {
  key: ExecutionAxisKey;
  rating: number; // 1 à 5
  evidence: string;
}

export interface LossChainStep {
  level: ChainLevel;
  text: string;
  proof: string;
}

// Un deal perdu vaut toujours une relance : la question est quand et comment.
export interface LossReopen {
  date: string | null; // YYYY-MM-DD future ; null si l'IA n'a pas donné de date valide
  timing: string; // pourquoi cette date
  who: string; // qui contacter (nom et rôle, ou rôle à trouver)
  how: string; // canal, angle, ce qui a changé depuis
  watchFor: string; // signal qui justifierait d'avancer la relance
}

// 2 = plan de relance "quand et comment" (2026-10-29). Les analyses v1 avaient
// un verdict yes/maybe/no : l'UI propose de les relancer.
export const LOSS_ANALYSIS_SCHEMA_VERSION = 2;

export interface LossSources {
  emails: number;
  meetings: number;
  calls: number;
  notes: number;
  slack: number;
}

export interface LossAnalysis {
  schemaVersion?: number;
  // null = pas assez d'échanges pour trancher (jamais de raison inventée).
  primaryReason: LossReasonKey | null;
  secondaryReason: LossReasonKey | null;
  controllable: Controllable;
  reasonExplanation: string;
  hubspotReason: string;
  execution: LossExecution[];
  phases: LossPhase[];
  chain: LossChainStep[];
  reopen: LossReopen;
  sources: LossSources;
}

// Faits déterministes d'un deal perdu, calculés par /api/deals/details.
export interface LostFacts {
  lostAt: string;
  declaredReason: string;
  lostAtStage: { label: string; enteredAt: string; days: number } | null;
  lastProspectReplyAt: string | null;
  lastProspectReplyVia: "email" | "meeting" | null;
}

const REASON_KEYS = LOSS_REASONS.map((r) => r.key) as readonly string[];
const PHASE_KINDS: PhaseKind[] = ["momentum", "stall", "silence"];
const CHAIN_LEVELS: ChainLevel[] = ["symptom", "cause", "deeper_cause", "root_cause"];
const DAY_MS = 864e5;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function lossReasonLabel(key: LossReasonKey | null | undefined): string {
  if (!key) return "Not enough data";
  return LOSS_REASONS.find((r) => r.key === key)?.label ?? key;
}

export function isoDay(v: unknown): string | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

// HubSpot : "-" ou vide = l'AE n'a rien saisi.
export function normalizeDeclaredReason(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return /^[-–—.\s]*$/.test(s) ? "" : s;
}

// Étape d'où le deal est tombé. L'historique `dealstage` de HubSpot arrive le
// plus récent en premier : on saute les entrées de l'étape perdue, puis on
// prend la première étape différente avec sa date d'entrée (début de la série
// d'entrées identiques consécutives).
export function stageBeforeLoss(
  history: { value: string; timestamp: string }[],
  lostStageId: string,
): { stageId: string; enteredAt: string } | null {
  let i = 0;
  while (i < history.length && history[i].value === lostStageId) i++;
  if (i >= history.length || !history[i].value) return null;
  const stageId = history[i].value;
  let enteredAt = history[i].timestamp;
  while (i + 1 < history.length && history[i + 1].value === stageId) {
    i++;
    enteredAt = history[i].timestamp;
  }
  return { stageId, enteredAt };
}

export function executionOverall(execution: LossExecution[]): number | null {
  if (execution.length === 0) return null;
  const mean = execution.reduce((s, e) => s + e.rating, 0) / execution.length;
  return Math.round(mean * 10) / 10;
}

// ─── Assainissement de la sortie IA ────────────────────────────────────────

function sanitizeReason(v: unknown): LossReasonKey | null {
  const s = str(v);
  return REASON_KEYS.includes(s) ? (s as LossReasonKey) : null;
}

// Phases contiguës de la création du deal à sa perte : la 1re démarre à la
// création, chacune finit au début de la suivante, la dernière au jour de la
// perte. Les phases de durée nulle disparaissent (sauf s'il n'y en a qu'une).
function sanitizePhases(raw: unknown, bounds: { start: string; end: string }): LossPhaseDraft[] {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .map((p) => {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const kind = str(o.kind) as PhaseKind;
      const start = isoDay(o.start);
      const events = (Array.isArray(o.events) ? o.events : [])
        .map((e) => {
          const eo = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
          return { date: isoDay(eo.date) ?? "", label: str(eo.label) };
        })
        .filter((e) => e.date && e.label)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 4);
      return PHASE_KINDS.includes(kind) && start ? { kind, start, end: "", events } : null;
    })
    .filter((p): p is LossPhaseDraft => p !== null)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);
  if (items.length === 0) return [];

  items[0].start = bounds.start;
  for (let i = 0; i < items.length; i++) {
    if (items[i].start < bounds.start) items[i].start = bounds.start;
    if (items[i].start > bounds.end) items[i].start = bounds.end;
  }
  for (let i = 0; i < items.length; i++) {
    items[i].end = i + 1 < items.length ? items[i + 1].start : bounds.end;
  }
  const kept = items.filter((p) => p.end > p.start);
  return kept.length > 0 ? kept : [{ ...items[items.length - 1], start: bounds.start, end: bounds.end }];
}

function sanitizeExecution(raw: unknown): LossExecution[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of raw) {
    if (item && typeof item === "object") {
      const k = str((item as Record<string, unknown>).key);
      if (k) byKey.set(k, item as Record<string, unknown>);
    }
  }
  return EXECUTION_AXES.flatMap(({ key }) => {
    const item = byKey.get(key);
    const rating = Math.round(Number(item?.rating));
    if (!item || !Number.isFinite(rating)) return [];
    return [{ key, rating: Math.min(5, Math.max(1, rating)), evidence: str(item.evidence) }];
  });
}

function sanitizeChain(raw: unknown): LossChainStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { level: str(o.level) as ChainLevel, text: str(o.text), proof: str(o.proof) };
    })
    .filter((s) => CHAIN_LEVELS.includes(s.level) && s.text)
    .sort((a, b) => CHAIN_LEVELS.indexOf(a.level) - CHAIN_LEVELS.indexOf(b.level))
    .slice(0, 4);
}

// Date de relance : strictement future, sinon null (l'UI propose de relancer
// l'analyse). Le code n'invente jamais de date de repli.
function sanitizeReopen(raw: unknown, today: string): LossReopen {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const date = isoDay(o.date);
  return {
    date: date && date > today ? date : null,
    timing: str(o.timing),
    who: str(o.who),
    how: str(o.how),
    watchFor: str(o.watch_for),
  };
}

export function isCurrentLossAnalysis(a: Pick<LossAnalysis, "schemaVersion"> | null | undefined): boolean {
  return a?.schemaVersion === LOSS_ANALYSIS_SCHEMA_VERSION;
}

export function sanitizeLossOutput(
  raw: unknown,
  bounds: { start: string; end: string },
): Omit<LossAnalysis, "phases" | "sources" | "schemaVersion"> & { phases: LossPhaseDraft[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const primaryReason = sanitizeReason(o.primary_reason);
  const secondary = sanitizeReason(o.secondary_reason);
  const controllable = str(o.controllable) as Controllable;
  return {
    primaryReason,
    secondaryReason: secondary && secondary !== primaryReason ? secondary : null,
    controllable: controllable in CONTROLLABLE_LABELS ? controllable : "shared",
    reasonExplanation: str(o.reason_explanation),
    hubspotReason: str(o.hubspot_reason).slice(0, 250),
    execution: sanitizeExecution(o.execution),
    phases: sanitizePhases(o.phases, bounds),
    chain: sanitizeChain(o.chain),
    reopen: sanitizeReopen(o.reopen, new Date().toISOString().slice(0, 10)),
  };
}

// ─── Métriques par phase (déterministes) ───────────────────────────────────

export interface DealActivity {
  inbound: number[]; // timestamps des emails reçus du prospect
  outbound: number[]; // timestamps des emails envoyés par Coachello
  meetingDays: string[]; // YYYY-MM-DD des meetings (HubSpot + Claap, dédoublonnés)
}

// Délais de réponse : pour chaque email du prospect, temps écoulé depuis notre
// PREMIER message resté sans réponse (3 relances puis une réponse = délai
// depuis la 1re relance, ce qui mesure la vraie réactivité).
function replyDelays(activity: DealActivity): { at: number; days: number }[] {
  const evts = [
    ...activity.inbound.map((t) => ({ t, inbound: true })),
    ...activity.outbound.map((t) => ({ t, inbound: false })),
  ].sort((a, b) => a.t - b.t);
  const out: { at: number; days: number }[] = [];
  let pendingSince: number | null = null;
  for (const e of evts) {
    if (!e.inbound) {
      if (pendingSince === null) pendingSince = e.t;
    } else {
      if (pendingSince !== null) out.push({ at: e.t, days: (e.t - pendingSince) / DAY_MS });
      pendingSince = null;
    }
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function withPhaseMetrics(phases: LossPhaseDraft[], activity: DealActivity): LossPhase[] {
  const delays = replyDelays(activity);
  return phases.map((p, i) => {
    const from = Date.parse(`${p.start}T00:00:00Z`);
    // La dernière phase inclut toute la journée de la perte.
    const to = Date.parse(`${p.end}T00:00:00Z`) + (i === phases.length - 1 ? DAY_MS : 0);
    const inRange = (t: number) => t >= from && t < to;
    const d = median(delays.filter((x) => inRange(x.at)).map((x) => x.days));
    return {
      ...p,
      metrics: {
        meetings: activity.meetingDays.filter((day) => day >= p.start && (day < p.end || (i === phases.length - 1 && day === p.end))).length,
        replies: activity.inbound.filter(inRange).length,
        medianReplyDays: d === null ? null : Math.round(d * 10) / 10,
      },
    };
  });
}
