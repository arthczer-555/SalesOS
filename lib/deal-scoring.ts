// Deal scoring algorithm based on 3 Coachello models (Generic, Human Coaching, AI Coaching)

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
