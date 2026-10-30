// ────────────────────────────────────────────────────────────────────────
// Calcul du pot d'équipe, sans I/O : factures de l'onglet Factures + paliers
// déjà figés en base -> état complet affiché par la page /pot, annoncé sur
// Slack et lu par l'outil get_team_pot. Règles : ./config.ts.
//
// - Total = point de départ figé + factures facturées (New + Renew) datées du
//   30/10 au 31/12/2026, dans l'ordre des dates (puis du montant).
// - Un palier atteint reste acquis, même si une correction fait redescendre
//   le total : les paliers figés en base sont toujours comptés.
// - "Qui a franchi" un palier = la facture pendant laquelle le cumul le
//   dépasse ; une fois figé en base, il ne bouge plus.
// - Bonus AI : la part du pot d'une facture AI compte 1,5x (formule de la
//   maquette : +0,5 x montant x 1 000/50k dans la zone 2,15M-2,7M, x 2 000/50k
//   dans 2,7M-3,0M ; rien au-delà de 3,0M).
// ────────────────────────────────────────────────────────────────────────

import { isBilled, type Invoice } from "@/lib/billing/invoices";
import { norm } from "@/lib/billing/drive-xlsx";
import {
  POT_ACCEL_BONUS,
  POT_AI_MULTIPLIER,
  POT_BASELINE,
  POT_BONUS,
  POT_END,
  POT_END_LEVEL,
  POT_GATE,
  POT_LAST_DAY,
  POT_LAUNCH_DAY,
  POT_LEVELS,
  POT_START,
  POT_STEP,
} from "./config";

export type PotWin = {
  key: string; // société|date|montant : sert à repérer les nouvelles factures d'une semaine
  company: string;
  amount: number;
  date: string; // YYYY-MM-DD
  kind: "New" | "Renewal";
  owner: string | null; // AE pour un New, AM pour un Renew
  isAi: boolean;
  before: number; // cumul avant cette facture
  after: number;
  aiBonus: number;
};

export type PotCrosser = {
  company: string;
  owner: string | null;
  amount: number;
  date: string;
  isAi: boolean;
  aiBonus: number;
};

/** Palier figé en base (table team_pot_milestones). */
export type FrozenMilestone = { level: number; reachedAt: string; crossedBy: PotCrosser | null };

export type PotMilestone = {
  level: number;
  bonus: number;
  reached: boolean;
  reachedAt: string | null; // null tant que la synchro ne l'a pas figé
  crossedBy: PotCrosser | null;
  potAt: number; // pot des paliers cumulé jusqu'à celui-ci inclus
};

export type PotState = {
  baseline: number;
  total: number;
  added: number; // total - baseline
  wins: PotWin[]; // ordre chronologique
  milestones: PotMilestone[]; // ordre croissant
  reachedCount: number;
  milestonePot: number;
  aiBonus: number;
  pot: number;
  next: { level: number; bonus: number; toGo: number } | null;
  lastInvoiceDate: string | null; // dernière facture saisie dans le classeur, toutes dates
  computedAt: string;
};

function overlap(a: number, b: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(b, hi) - Math.max(a, lo));
}

function aiBonusFor(before: number, after: number): number {
  const extra = POT_AI_MULTIPLIER - 1;
  const base = overlap(before, after, POT_START - POT_STEP, POT_GATE) * (POT_BONUS / POT_STEP);
  const accel = overlap(before, after, POT_GATE, POT_END_LEVEL) * (POT_ACCEL_BONUS / POT_STEP);
  return Math.round(extra * (base + accel));
}

/** Factures qui comptent pour le pot : facturées (New + Renew) et datées dans la période. */
export function potInvoices(invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => isBilled(i) && i.date >= POT_LAUNCH_DAY && i.date <= POT_LAST_DAY);
}

export function computePot(
  invoices: Invoice[],
  frozen: FrozenMilestone[],
  opts: { lastInvoiceDate?: string | null; now?: Date } = {},
): PotState {
  const sorted = potInvoices(invoices).sort(
    (a, b) => a.date.localeCompare(b.date) || b.amount - a.amount || a.company.localeCompare(b.company),
  );

  let run = POT_BASELINE;
  const wins: PotWin[] = sorted.map((i) => {
    const before = run;
    run += i.amount;
    const isAi = norm(i.type) === "ai";
    const isNew = i.status === "new";
    return {
      key: `${norm(i.company)}|${i.date}|${i.amount}`,
      company: i.company,
      amount: i.amount,
      date: i.date,
      kind: isNew ? "New" : "Renewal",
      owner: (isNew ? i.ae ?? i.am : i.am ?? i.ae) ?? null,
      isAi,
      before,
      after: run,
      aiBonus: isAi ? aiBonusFor(before, run) : 0,
    };
  });
  const total = run;

  const frozenByLevel = new Map(frozen.map((f) => [f.level, f]));
  let potAt = 0;
  const milestones: PotMilestone[] = POT_LEVELS.map(({ level, bonus }) => {
    potAt += bonus;
    const fixed = frozenByLevel.get(level);
    const crosser = wins.find((w) => w.before < level && w.after >= level);
    return {
      level,
      bonus,
      reached: !!fixed || total >= level,
      reachedAt: fixed?.reachedAt ?? null,
      crossedBy:
        fixed?.crossedBy ??
        (crosser
          ? {
              company: crosser.company,
              owner: crosser.owner,
              amount: crosser.amount,
              date: crosser.date,
              isAi: crosser.isAi,
              aiBonus: crosser.aiBonus,
            }
          : null),
      potAt,
    };
  });

  const reached = milestones.filter((m) => m.reached);
  const milestonePot = reached.reduce((s, m) => s + m.bonus, 0);
  const aiBonus = wins.reduce((s, w) => s + w.aiBonus, 0);
  const nextLevel = milestones.find((m) => !m.reached);

  return {
    baseline: POT_BASELINE,
    total,
    added: total - POT_BASELINE,
    wins,
    milestones,
    reachedCount: reached.length,
    milestonePot,
    aiBonus,
    pot: milestonePot + aiBonus,
    next: nextLevel ? { level: nextLevel.level, bonus: nextLevel.bonus, toGo: Math.max(0, nextLevel.level - total) } : null,
    lastInvoiceDate: opts.lastInvoiceDate ?? null,
    computedAt: (opts.now ?? new Date()).toISOString(),
  };
}

export type PotPace = {
  daysLeft: number;
  weeksLeft: number; // arrondi, pour l'affichage
  toGate: number;
  toEnd: number;
  perWeekToGate: number;
  perWeekToEnd: number;
};

/** Temps restant et rythme hebdo nécessaire, à l'instant `now`. */
export function potPace(state: Pick<PotState, "total">, now: Date = new Date()): PotPace {
  const daysLeft = Math.max(0, Math.ceil((POT_END.getTime() - now.getTime()) / 86_400_000));
  const weeks = Math.max(daysLeft / 7, 1);
  const toGate = Math.max(0, POT_GATE - state.total);
  const toEnd = Math.max(0, POT_END_LEVEL - state.total);
  return {
    daysLeft,
    weeksLeft: Math.max(1, Math.round(daysLeft / 7)),
    toGate,
    toEnd,
    perWeekToGate: toGate / weeks,
    perWeekToEnd: toEnd / weeks,
  };
}
