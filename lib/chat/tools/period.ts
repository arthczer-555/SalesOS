/**
 * Périodes des outils CoachelloAI : dates "YYYY-MM-DD" interprétées en heure
 * de Paris (fuseau de l'équipe et des agents), bornes incluses. Le passage à
 * l'heure d'été est géré par zonedToUtc (lib/agents/schedule.ts).
 */

import { DEFAULT_TIMEZONE, zonedToUtc } from "@/lib/agents/schedule";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && ISO_DAY.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

/** Jour courant à Paris, "YYYY-MM-DD". */
export function parisToday(now: Date = new Date()): string {
  return now.toLocaleDateString("fr-CA", { timeZone: DEFAULT_TIMEZONE });
}

/** Jour (Paris) d'un ts Slack ("1727512345.000100") ou d'un epoch ms. */
export function parisDayOf(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("fr-CA", { timeZone: DEFAULT_TIMEZONE });
}

/** Date + heure (Paris) lisible, "YYYY-MM-DD HH:MM". */
export function parisDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const time = d.toLocaleTimeString("fr-FR", { timeZone: DEFAULT_TIMEZONE, hour: "2-digit", minute: "2-digit" });
  return `${parisDayOf(epochMs)} ${time}`;
}

function startOfParisDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0, DEFAULT_TIMEZONE).getTime();
}

/**
 * Bornes epoch (ms) d'une période en jours de Paris, incluses :
 * du début de `from` à la dernière milliseconde de `to`.
 */
export function parisDayRange(from: string, to: string): { startMs: number; endMs: number } {
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10);
  return { startMs: startOfParisDay(from), endMs: startOfParisDay(next) - 1 };
}

/**
 * Lit date_from / date_to d'un input d'outil. Erreur lisible (pour le modèle)
 * si une date manque ou est mal formée, plutôt qu'une période silencieusement
 * élargie.
 */
export function readPeriod(
  input: Record<string, unknown>,
): { ok: true; from: string; to: string; startMs: number; endMs: number } | { ok: false; error: string } {
  const from = input.date_from;
  const to = input.date_to ?? parisToday();
  if (!isIsoDay(from)) return { ok: false, error: "date_from manquant ou invalide (format YYYY-MM-DD attendu)." };
  if (!isIsoDay(to)) return { ok: false, error: "date_to invalide (format YYYY-MM-DD attendu)." };
  if (to < from) return { ok: false, error: `Période vide : date_to (${to}) est avant date_from (${from}).` };
  return { ok: true, from, to, ...parisDayRange(from, to) };
}
