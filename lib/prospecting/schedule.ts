// Calendrier d'envoi : fenêtres horaires par fuseau, jours d'envoi, délais en
// jours d'envoi. Module pur, sans dépendance (Intl uniquement), robuste aux
// changements d'heure (DST). Testé par scripts/test-prospecting-schedule.ts.
import type { SendWindow } from "./types";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 1 = lundi ... 7 = dimanche */
  weekday: number;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY[get("weekday")] ?? 1,
  };
}

/** Décalage (minutes) du fuseau par rapport à UTC à l'instant donné. */
function offsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** Heure locale (dans tz) -> instant UTC. Deux passes pour les jours de DST. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = offsetMinutes(new Date(guess), tz);
  let result = guess - off1 * 60_000;
  const off2 = offsetMinutes(new Date(result), tz);
  if (off2 !== off1) result = guess - off2 * 60_000;
  return new Date(result);
}

export type LocalDay = { year: number; month: number; day: number };

export function localDay(date: Date, tz: string): LocalDay {
  const p = zonedParts(date, tz);
  return { year: p.year, month: p.month, day: p.day };
}

export function localDayKey(d: LocalDay): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function parseDayKey(key: string): LocalDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Jour civil suivant (arithmétique de calendrier pure, indépendante du fuseau). */
function nextDay(d: LocalDay): LocalDay {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function weekdayOf(d: LocalDay): number {
  const w = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0 = dimanche
  return w === 0 ? 7 : w;
}

function hm(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

function minutesOfDay(s: string): number {
  const { h, m } = hm(s);
  return h * 60 + m;
}

export function windowStartUtc(d: LocalDay, w: SendWindow): Date {
  const { h, m } = hm(w.start);
  return zonedTimeToUtc(d.year, d.month, d.day, h, m, w.timezone);
}

export function windowEndUtc(d: LocalDay, w: SendWindow): Date {
  const { h, m } = hm(w.end);
  return zonedTimeToUtc(d.year, d.month, d.day, h, m, w.timezone);
}

export function localDayStartUtc(now: Date, tz: string): Date {
  const d = localDay(now, tz);
  return zonedTimeToUtc(d.year, d.month, d.day, 0, 0, tz);
}

export function isSendDay(d: LocalDay, w: SendWindow): boolean {
  return w.days.includes(weekdayOf(d));
}

export function isInWindow(now: Date, w: SendWindow): boolean {
  const p = zonedParts(now, w.timezone);
  if (!w.days.includes(p.weekday)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= minutesOfDay(w.start) && mins < minutesOfDay(w.end);
}

/** Premier instant >= after qui tombe dans la fenêtre d'envoi. */
export function nextWindowOpen(after: Date, w: SendWindow): Date {
  if (isInWindow(after, w)) return after;
  let d = localDay(after, w.timezone);
  for (let i = 0; i < 15; i++) {
    if (isSendDay(d, w)) {
      const start = windowStartUtc(d, w);
      const end = windowEndUtc(d, w);
      if (after < start) return start;
      if (after < end) return after;
    }
    d = nextDay(d);
  }
  return after; // fenêtre vide : ne devrait pas arriver (normalizeWindow l'empêche)
}

/** Avance de n jours d'envoi à partir de `from` (exclu). n = 0 -> from. */
export function addSendDays(from: LocalDay, n: number, w: SendWindow): LocalDay {
  let d = from;
  let left = n;
  let guard = 0;
  while (left > 0 && guard < 400) {
    d = nextDay(d);
    if (isSendDay(d, w)) left--;
    guard++;
  }
  return d;
}

/** Premier jour d'envoi >= d. */
export function firstSendDayOnOrAfter(d: LocalDay, w: SendWindow): LocalDay {
  let cur = d;
  for (let i = 0; i < 15; i++) {
    if (isSendDay(cur, w)) return cur;
    cur = nextDay(cur);
  }
  return d;
}

/** Instant aléatoire dans [start, end - 30 min] du jour donné (heure locale). */
export function pickSlot(d: LocalDay, w: SendWindow, rand: () => number = Math.random): Date {
  const start = windowStartUtc(d, w).getTime();
  const end = windowEndUtc(d, w).getTime() - 30 * 60_000;
  if (end <= start) return new Date(start);
  return new Date(start + Math.floor(rand() * (end - start)));
}

/**
 * Prochaine exécution après une étape exécutée à `executedAt`.
 * - delay 0 : 5 à 20 min plus tard (dans la fenêtre).
 * - delay n : un créneau aléatoire n jours d'envoi plus tard.
 */
export function computeNextRunAt(executedAt: Date, delayDays: number, w: SendWindow, rand: () => number = Math.random): Date {
  if (delayDays <= 0) {
    const candidate = new Date(executedAt.getTime() + (5 + Math.floor(rand() * 15)) * 60_000);
    return nextWindowOpen(candidate, w);
  }
  const target = addSendDays(localDay(executedAt, w.timezone), delayDays, w);
  return pickSlot(target, w, rand);
}

/** Date de démarrage d'un prospect au lancement (respecte startDate). */
export function firstRunAt(now: Date, w: SendWindow, startDate: string | null): Date {
  const start = startDate ? parseDayKey(startDate) : null;
  if (start) {
    const startUtc = windowStartUtc(start, w);
    if (startUtc > now) return nextWindowOpen(startUtc, w);
  }
  return nextWindowOpen(now, w);
}

/** Nombre de ticks restants avant la fin de la fenêtre aujourd'hui (0 si hors fenêtre). */
export function ticksLeftToday(now: Date, w: SendWindow, tickMinutes = 10): number {
  if (!isInWindow(now, w)) return 0;
  const p = zonedParts(now, w.timezone);
  const left = minutesOfDay(w.end) - (p.hour * 60 + p.minute);
  return Math.max(1, Math.ceil(left / tickMinutes));
}

/** Minutes d'envoi par jour (pour l'estimation de débit). */
export function windowMinutes(w: SendWindow): number {
  return Math.max(0, minutesOfDay(w.end) - minutesOfDay(w.start));
}

/**
 * Projection déterministe des dates d'exécution d'une séquence (aperçu UI) :
 * chaque étape au début de fenêtre + 1h du jour cible.
 */
export function projectSchedule(start: Date, delays: number[], w: SendWindow): Date[] {
  const out: Date[] = [];
  let day = localDay(nextWindowOpen(start, w), w.timezone);
  delays.forEach((delay, i) => {
    if (i > 0) day = addSendDays(day, delay, w);
    const s = windowStartUtc(day, w);
    out.push(i === 0 ? nextWindowOpen(start, w) : new Date(s.getTime() + 60 * 60_000));
  });
  return out;
}
