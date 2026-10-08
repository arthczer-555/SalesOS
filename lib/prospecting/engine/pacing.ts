// Pacing des envois : cap journalier de la boîte et volume réparti sur la
// fenêtre d'envoi (quelques emails par tick, jamais une rafale). Module pur.
import { MAILBOX_HARD_MAX } from "../settings";

/** Emails encore envoyables aujourd'hui par la boîte (cap en dur à 100). */
export function mailboxCapLeft(dailyLimit: number, sentToday: number): number {
  return Math.max(0, Math.min(dailyLimit, MAILBOX_HARD_MAX) - sentToday);
}

/**
 * Budget d'emails pour ce tick : le reste du jour réparti sur les ticks restants
 * avec un jitter de +/- 30 %, borné à [1, 6] (et au cap restant).
 */
export function tickBudget(capLeft: number, ticksLeft: number, rand: () => number = Math.random): number {
  if (capLeft <= 0) return 0;
  const raw = Math.round((capLeft / Math.max(1, ticksLeft)) * (0.7 + rand() * 0.6));
  return Math.min(capLeft, Math.max(1, Math.min(6, raw)));
}

/** Pause aléatoire entre deux envois d'une même boîte (20 à 60 s). */
export function pauseBetweenSendsMs(rand: () => number = Math.random): number {
  return 20_000 + Math.floor(rand() * 40_000);
}

/** Backoff d'une erreur transitoire : 10 min x 2^tentatives. */
export function transientBackoffMs(attempts: number): number {
  return 10 * 60_000 * 2 ** Math.max(0, attempts);
}

export const MAX_SEND_ATTEMPTS = 4;
