// Barèmes d'incentive des reps. C'est ici qu'on écrit les formules.
//
// Provisoire : un barème par rep, en code, le temps de fixer des formules
// communes à toute l'équipe. Les entrées sont de la donnée pure (pas de
// fonction propre à un rep) : c'est la forme qu'on stockera en base quand une
// page d'administration arrivera, et seule `findIncentivePlan` changera alors.
//
// Quota et facturé ne sont pas ici : ils viennent du Sheet revenue (target,
// target actualisé et facturé du flux `stream`), via le snapshot AE Activity.
//
// Confidentiel : la prime n'est renvoyée qu'au rep lui-même (/api/me/dashboard)
// et aux admins ("Voir comme"), jamais dans les vues d'équipe ni au chat.

import type { RevenuePerf } from "@/lib/ae-activity/types";
import type { StepsConfig } from "./steps";
import type { TieredConfig } from "./tiered";

// Forme du barème : taux de commission par tranche (tiered.ts) ou montant
// forfaitaire par palier (steps.ts).
export type IncentiveFormula = ({ kind: "tiered" } & TieredConfig) | ({ kind: "steps" } & StepsConfig);

export type IncentivePlan = {
  email: string; // email CoachelloHQ du rep (users.email)
  year: number;
  stream: keyof Pick<RevenuePerf, "newBiz" | "renew" | "csmRenew">; // flux du Sheet revenue qui sert de base
  // quarter : une prime par trimestre sur les targets trimestriels, l'année = la somme.
  // year : une prime sur l'année, calculée sur le target initial ET sur le
  // target actualisé (qui n'existe qu'à l'année dans le Sheet), côte à côte.
  period: "quarter" | "year";
  source: string; // d'où vient le barème, affiché au rep
  formula: IncentiveFormula;
};

export const INCENTIVE_PLANS: IncentivePlan[] = [
  {
    // Sheet "Modèle incentive Mehdi 2026" (1hnjjsh4dk3ZdFAsBDv8cqasOvCjWTb6WkV7Pjt_a1uo).
    // Plancher 30 % : note du Sheet, sa formule l'oubliait (validé par Arthur
    // le 2026-10-29). Pas de pondération inbound à 80 % (onglet "Revenue
    // Mehdi") : le New facturé compte à 100 %.
    email: "mehdi@coachello.io",
    year: 2026,
    stream: "newBiz",
    period: "quarter",
    source: "Incentive model 2026",
    formula: {
      kind: "tiered",
      tiers: [
        { upTo: 0.5, rate: 0.075, multiplier: 0.6 },
        { upTo: 1.0, rate: 0.075, multiplier: 1 },
        { upTo: 1.2, rate: 0.075, multiplier: 1.05 },
        { upTo: 1.5, rate: 0.075, multiplier: 1.1 },
        { upTo: 2.0, rate: 0.075, multiplier: 1.2 },
      ],
      floor: 0.3,
      fullRateAt: { threshold: 1, rate: 0.075 },
    },
  },
  {
    // Barème "Pipe Target (6K)" transmis par Arthur le 2026-10-29 : un montant
    // fixe par palier d'atteinte du target annuel Renew CSM (onglet Suivi CSM).
    // Décisions du même jour : palier atteint sans interpolation, et prime
    // calculée sur le target actualisé ET sur le target initial, affichés
    // côte à côte (ni l'un ni l'autre n'est désigné comme le seul qui paie).
    email: "julie@coachello.io",
    year: 2026,
    stream: "csmRenew",
    period: "year",
    source: "Pipe target 2026 (6K € at 100%)",
    formula: {
      kind: "steps",
      steps: [
        { at: 0.8, amount: 3_000 },
        { at: 0.9, amount: 4_000 },
        { at: 1.0, amount: 6_000 },
        { at: 1.1, amount: 7_000 },
        { at: 1.2, amount: 8_000 },
        { at: 1.3, amount: 9_000 },
        { at: 1.4, amount: 10_000 },
        { at: 1.5, amount: 12_000 },
      ],
    },
  },
];

export function findIncentivePlan(email: string | null | undefined, year: number): IncentivePlan | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return INCENTIVE_PLANS.find((p) => p.year === year && p.email.toLowerCase() === e) ?? null;
}
