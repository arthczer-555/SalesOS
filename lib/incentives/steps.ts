// Moteur de calcul d'une prime à paliers fixes : chaque palier d'atteinte du
// target paie un montant forfaitaire (barème de Julie : 80 % = 3K ... 150 % = 12K).
//
//   - le palier atteint paie son montant, sans interpolation jusqu'au suivant ;
//   - sous le premier palier, prime nulle ;
//   - au-delà du dernier palier, plus rien (plafond de fait).
//
// Pur et sans dépendance : utilisable côté serveur comme côté client.

import type { NextUnlock } from "./tiered";

export type IncentiveStep = {
  at: number; // ratio d'atteinte qui déclenche le palier (0.8 = 80 %)
  amount: number; // prime forfaitaire en EUR
};

export type StepsConfig = {
  steps: IncentiveStep[]; // croissants
};

export type StepsResult = {
  attainment: number; // ratio
  amount: number;
  reached: IncentiveStep | null; // null sous le premier palier
  capped: boolean; // dernier palier atteint : le surplus ne paie plus
};

const pctLabel = (r: number) => `${Math.round(r * 100_000) / 1000}%`;
const eurLabel = (n: number) => `${Math.round(n).toLocaleString("en-US")} €`;

function reachedStep(config: StepsConfig, attainment: number): IncentiveStep | null {
  return config.steps.filter((s) => attainment >= s.at).at(-1) ?? null;
}

export function computeSteps(config: StepsConfig, quota: number, billed: number): StepsResult {
  const attainment = quota > 0 ? billed / quota : 0;
  const reached = reachedStep(config, attainment);
  const last = config.steps.at(-1);
  return {
    attainment,
    amount: reached?.amount ?? 0,
    reached,
    capped: last != null && attainment >= last.at,
  };
}

/** Les règles du barème en anglais clair, pour le bloc "How it's computed". */
export function describeSteps(config: StepsConfig, period: "quarterly" | "yearly"): string[] {
  const out = config.steps.map((s) => `${pctLabel(s.at)} of the ${period} target: ${eurLabel(s.amount)}`);
  const first = config.steps[0];
  const last = config.steps.at(-1);
  out.push("The highest step reached pays its amount, no interpolation between steps");
  if (first) out.push(`No incentive below ${pctLabel(first.at)}`);
  if (last) out.push(`Nothing more above ${pctLabel(last.at)}`);
  return out;
}

/** Le prochain palier et ce qu'il reste à facturer pour l'atteindre. Null au plafond. */
export function nextStep(config: StepsConfig, quota: number, billed: number): NextUnlock | null {
  if (quota <= 0) return null;
  const att = billed / quota;
  const step = config.steps.find((s) => s.at > att);
  if (!step) return null;
  return { threshold: step.at, toBill: Math.ceil(step.at * quota - billed), label: `pays ${eurLabel(step.amount)}` };
}
