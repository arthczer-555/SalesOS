// Prime d'un rep : barème (plans.ts) appliqué au target et au facturé de son
// snapshot. Calculée à la lecture, jamais stockée : un barème modifié
// s'applique au déploiement, sans refresh HubSpot.
//
//   - plan trimestriel (Mehdi) : une prime par trimestre sur les targets
//     trimestriels, l'année = la somme ;
//   - plan annuel (Julie) : une prime sur l'année, calculée deux fois, sur le
//     target actualisé et sur le target initial, affichées côte à côte.

import type { QuarterAmount, RevenueStream } from "@/lib/ae-activity/types";
import type { IncentiveFormula, IncentivePlan } from "./plans";
import { computeSteps, describeSteps, nextStep, type IncentiveStep } from "./steps";
import { computeTiered, describeTiered, nextUnlock, type NextUnlock } from "./tiered";

export type IncentiveStatus = "closed" | "in_progress" | "upcoming";

export type IncentiveQuarter = {
  quarter: QuarterAmount["quarter"];
  status: IncentiveStatus;
  quota: number | null;
  billed: number | null;
  attainment: number | null; // ratio
  amount: number | null; // null = pas calculable (voir error) ou trimestre à venir
  belowFloor: boolean;
  capped: boolean;
  error: string | null;
};

type SummaryBase = {
  year: number;
  stream: IncentivePlan["stream"];
  source: string;
  rules: string[];
};

export type QuarterlyIncentiveSummary = SummaryBase & {
  period: "quarter";
  quarters: IncentiveQuarter[];
  total: number; // somme des trimestres calculables
  incomplete: boolean; // au moins un trimestre passé ou en cours sans montant
  currentQuarter: QuarterAmount["quarter"] | null; // null hors de l'année du plan
  nextUnlock: NextUnlock | null; // sur le trimestre en cours
};

// La prime annuelle sur l'un des deux targets du Sheet.
export type IncentiveYearBasis = {
  basis: "revised" | "initial";
  target: number | null;
  attainment: number | null; // ratio
  amount: number | null; // null = pas calculable (voir error) ou année à venir
  reached: number | null; // palier atteint (ratio) d'un barème à paliers, null sinon
  capped: boolean;
  nextUnlock: NextUnlock | null; // seulement pendant l'année
  error: string | null;
};

export type YearlyIncentiveSummary = SummaryBase & {
  period: "year";
  status: IncentiveStatus;
  billed: number | null;
  bases: IncentiveYearBasis[]; // actualisé d'abord, puis initial
  steps: IncentiveStep[] | null; // paliers d'un barème à paliers, pour l'échelle affichée
};

export type IncentiveSummary = QuarterlyIncentiveSummary | YearlyIncentiveSummary;

const QUARTERS: QuarterAmount["quarter"][] = ["Q1", "Q2", "Q3", "Q4"];

type FormulaResult = {
  attainment: number;
  amount: number;
  belowFloor: boolean;
  capped: boolean;
  reached: number | null;
};

function computeFormula(f: IncentiveFormula, quota: number, billed: number): FormulaResult {
  if (f.kind === "tiered") {
    const r = computeTiered(f, quota, billed);
    return { attainment: r.attainment, amount: r.amount, belowFloor: r.belowFloor, capped: r.capped, reached: null };
  }
  const r = computeSteps(f, quota, billed);
  return {
    attainment: r.attainment,
    amount: r.amount,
    belowFloor: r.reached == null,
    capped: r.capped,
    reached: r.reached?.at ?? null,
  };
}

function describeFormula(f: IncentiveFormula, period: "quarterly" | "yearly"): string[] {
  return f.kind === "tiered" ? describeTiered(f, period) : describeSteps(f, period);
}

function nextUnlockFor(f: IncentiveFormula, quota: number, billed: number): NextUnlock | null {
  return f.kind === "tiered" ? nextUnlock(f, quota, billed) : nextStep(f, quota, billed);
}

export function buildIncentiveSummary(plan: IncentivePlan, stream: RevenueStream, now = new Date()): IncentiveSummary {
  return plan.period === "year" ? buildYearly(plan, stream, now) : buildQuarterly(plan, stream, now);
}

function buildQuarterly(plan: IncentivePlan, stream: RevenueStream, now: Date): QuarterlyIncentiveSummary {
  const year = now.getUTCFullYear();
  const nowQ = Math.floor(now.getUTCMonth() / 3) + 1;

  const quarters = QUARTERS.map((quarter, i): IncentiveQuarter => {
    const qNum = i + 1;
    const status: IncentiveStatus =
      plan.year < year || (plan.year === year && qNum < nowQ)
        ? "closed"
        : plan.year === year && qNum === nowQ
          ? "in_progress"
          : "upcoming";
    const row = stream.quarters.find((q) => q.quarter === quarter);
    const quota = row?.target ?? null;
    const billed = row?.billed ?? null;
    const base = { quarter, status, quota, billed, belowFloor: false, capped: false };

    if (status === "upcoming") return { ...base, attainment: null, amount: null, error: null };
    // Jamais de 0 par défaut : un quota ou un facturé absent du Sheet se dit.
    if (quota == null || quota <= 0) {
      return { ...base, attainment: null, amount: null, error: "No quarterly target in the revenue Sheet" };
    }
    if (billed == null) {
      return { ...base, attainment: null, amount: null, error: "No billed amount in the revenue Sheet" };
    }
    const r = computeFormula(plan.formula, quota, billed);
    return { ...base, attainment: r.attainment, amount: r.amount, belowFloor: r.belowFloor, capped: r.capped, error: null };
  });

  const current = plan.year === year ? quarters[nowQ - 1] : null;
  return {
    period: "quarter",
    year: plan.year,
    stream: plan.stream,
    source: plan.source,
    rules: describeFormula(plan.formula, "quarterly"),
    quarters,
    total: quarters.reduce((s, q) => s + (q.amount ?? 0), 0),
    incomplete: quarters.some((q) => q.status !== "upcoming" && q.amount == null),
    currentQuarter: current?.quarter ?? null,
    nextUnlock:
      current && current.quota != null && current.billed != null
        ? nextUnlockFor(plan.formula, current.quota, current.billed)
        : null,
  };
}

function buildYearly(plan: IncentivePlan, stream: RevenueStream, now: Date): YearlyIncentiveSummary {
  const year = now.getUTCFullYear();
  const status: IncentiveStatus = plan.year < year ? "closed" : plan.year === year ? "in_progress" : "upcoming";
  const billed = stream.billed;

  const basis = (kind: IncentiveYearBasis["basis"], target: number | null, missing: string): IncentiveYearBasis => {
    const base = { basis: kind, target, attainment: null, amount: null, reached: null, capped: false, nextUnlock: null };
    if (status === "upcoming") return { ...base, error: null };
    // Jamais de 0 par défaut : un target ou un facturé absent du Sheet se dit.
    if (target == null || target <= 0) return { ...base, error: missing };
    if (billed == null) return { ...base, error: "No billed amount in the revenue Sheet" };
    const r = computeFormula(plan.formula, target, billed);
    return {
      ...base,
      attainment: r.attainment,
      amount: r.amount,
      reached: r.reached,
      capped: r.capped,
      nextUnlock: status === "in_progress" ? nextUnlockFor(plan.formula, target, billed) : null,
      error: null,
    };
  };

  return {
    period: "year",
    year: plan.year,
    stream: plan.stream,
    source: plan.source,
    rules: describeFormula(plan.formula, "yearly"),
    status,
    billed,
    bases: [
      // undefined = snapshot calculé avant que le parseur lise "Target actu".
      basis(
        "revised",
        stream.revisedTarget ?? null,
        stream.revisedTarget === undefined
          ? "Revised target available after the next data refresh"
          : "No revised target in the revenue Sheet",
      ),
      basis("initial", stream.target, "No yearly target in the revenue Sheet"),
    ],
    steps: plan.formula.kind === "steps" ? plan.formula.steps : null,
  };
}
