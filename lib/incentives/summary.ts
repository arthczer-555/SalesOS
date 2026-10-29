// Prime d'un rep sur l'année : barème (plans.ts) appliqué au target et au
// facturé trimestriels de son snapshot. Calculée à la lecture, jamais stockée :
// un barème modifié s'applique au déploiement, sans refresh HubSpot.

import type { QuarterAmount, RevenueStream } from "@/lib/ae-activity/types";
import type { IncentivePlan } from "./plans";
import { computeTiered, describeTiered, nextUnlock, type NextUnlock } from "./tiered";

export type IncentiveQuarter = {
  quarter: QuarterAmount["quarter"];
  status: "closed" | "in_progress" | "upcoming";
  quota: number | null;
  billed: number | null;
  attainment: number | null; // ratio
  amount: number | null; // null = pas calculable (voir error) ou trimestre à venir
  belowFloor: boolean;
  capped: boolean;
  error: string | null;
};

export type IncentiveSummary = {
  year: number;
  stream: IncentivePlan["stream"];
  source: string;
  rules: string[];
  quarters: IncentiveQuarter[];
  total: number; // somme des trimestres calculables
  incomplete: boolean; // au moins un trimestre passé ou en cours sans montant
  currentQuarter: QuarterAmount["quarter"] | null; // null hors de l'année du plan
  nextUnlock: NextUnlock | null; // sur le trimestre en cours
};

const QUARTERS: QuarterAmount["quarter"][] = ["Q1", "Q2", "Q3", "Q4"];

export function buildIncentiveSummary(plan: IncentivePlan, stream: RevenueStream, now = new Date()): IncentiveSummary {
  const year = now.getUTCFullYear();
  const nowQ = Math.floor(now.getUTCMonth() / 3) + 1;

  const quarters = QUARTERS.map((quarter, i): IncentiveQuarter => {
    const qNum = i + 1;
    const status: IncentiveQuarter["status"] =
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
    const r = computeTiered(plan.config, quota, billed);
    return { ...base, attainment: r.attainment, amount: r.amount, belowFloor: r.belowFloor, capped: r.capped, error: null };
  });

  const current = plan.year === year ? quarters[nowQ - 1] : null;
  return {
    year: plan.year,
    stream: plan.stream,
    source: plan.source,
    rules: describeTiered(plan.config, "quarterly"),
    quarters,
    total: quarters.reduce((s, q) => s + (q.amount ?? 0), 0),
    incomplete: quarters.some((q) => q.status !== "upcoming" && q.amount == null),
    currentQuarter: current?.quarter ?? null,
    nextUnlock:
      current && current.quota != null && current.billed != null
        ? nextUnlock(plan.config, current.quota, current.billed)
        : null,
  };
}
