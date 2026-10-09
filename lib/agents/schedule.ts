/**
 * Planning d'un agent : modèle structuré (pas de cron brut, l'UI doit rester
 * lisible), calcul de la prochaine exécution dans le fuseau de l'agent, et
 * libellés. Isomorphe (front + serveur), sans dépendance : les décalages de
 * fuseau passent par Intl, ce qui gère l'heure d'été.
 *
 * Granularité réelle : le dispatcher tourne toutes les 10 min, un agent prévu à
 * 09:00 part donc entre 09:00 et 09:10.
 */

export type AgentFrequency = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "quarterly";

const FREQUENCIES: readonly AgentFrequency[] = ["daily", "weekdays", "weekly", "biweekly", "monthly", "quarterly"];

export type AgentSchedule = {
  frequency: AgentFrequency;
  /** weekly et biweekly : jours ISO, 1 = lundi … 7 = dimanche. */
  days: number[];
  /**
   * biweekly : parité des semaines où l'agent tourne (index de semaine depuis
   * le lundi 5 janvier 1970, modulo 2). Fixe la quinzaine de départ sans date
   * d'ancrage à stocker, et ne casse pas au passage d'année (contrairement à
   * la parité des semaines ISO, faussée par les années à 53 semaines).
   */
  weekParity: 0 | 1;
  /** monthly et quarterly (jan, avr, juil, oct) : jour du mois, 1 à 28 (évite les mois courts). */
  dayOfMonth: number;
  /** "HH:MM", heure locale du fuseau. */
  time: string;
  /** Fuseau IANA. */
  timezone: string;
};

export const DEFAULT_TIMEZONE = "Europe/Paris";

export const DEFAULT_SCHEDULE: AgentSchedule = {
  frequency: "weekly",
  days: [1],
  weekParity: 0,
  dayOfMonth: 1,
  time: "09:00",
  timezone: DEFAULT_TIMEZONE,
};

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/London", label: "London" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "UTC", label: "UTC" },
];

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** quarterly : premier mois de chaque trimestre. */
const QUARTER_MONTHS = ["Jan", "Apr", "Jul", "Oct"];

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un planning venu du front ou du modèle : valeurs bornées, jours
 * dédupliqués et triés. Ne throw jamais, retombe sur les défauts.
 */
export function normalizeSchedule(input: unknown): AgentSchedule {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const frequency: AgentFrequency = FREQUENCIES.includes(raw.frequency as AgentFrequency)
    ? (raw.frequency as AgentFrequency)
    : DEFAULT_SCHEDULE.frequency;
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
    : [];
  const dom = Number(raw.dayOfMonth ?? raw.day_of_month);
  const parity = Number(raw.weekParity ?? raw.week_parity);
  const time = typeof raw.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : DEFAULT_SCHEDULE.time;
  const tz = typeof raw.timezone === "string" && isValidTimezone(raw.timezone) ? raw.timezone : DEFAULT_TIMEZONE;
  const schedule: AgentSchedule = {
    frequency,
    days: (frequency === "weekly" || frequency === "biweekly") && days.length === 0 ? [1] : days,
    weekParity: parity === 1 ? 1 : 0,
    dayOfMonth: Number.isInteger(dom) && dom >= 1 && dom <= 28 ? dom : 1,
    time,
    timezone: tz,
  };
  // Quinzaine non précisée (planning déduit par l'IA) : celle qui donne la
  // première exécution la plus proche. Une fois enregistrée, elle ne bouge plus.
  if (frequency === "biweekly" && parity !== 0 && parity !== 1) schedule.weekParity = biweeklyStarts(schedule)[0].parity;
  return schedule;
}

// ── Fuseaux ─────────────────────────────────────────────────────────────────

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Décalage (ms) du fuseau à l'instant donné : heure locale - UTC. */
function offsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Instant UTC correspondant à une date/heure locale dans le fuseau. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = offsetMs(new Date(guess), tz);
  let ts = guess - off1;
  // Passage à l'heure d'été / d'hiver entre la supposition et le résultat.
  const off2 = offsetMs(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

/** Lundi 5 janvier 1970 (UTC) : origine des index de semaine du biweekly. */
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);
const WEEK_MS = 7 * 24 * 3600_000;

/** `cal` : date calendaire locale, encodée à minuit UTC. */
function matchesDay(s: AgentSchedule, cal: Date): boolean {
  const isoWeekday = cal.getUTCDay() === 0 ? 7 : cal.getUTCDay();
  switch (s.frequency) {
    case "daily":
      return true;
    case "weekdays":
      return isoWeekday <= 5;
    case "weekly":
      return s.days.includes(isoWeekday);
    case "biweekly":
      return s.days.includes(isoWeekday) && Math.floor((cal.getTime() - EPOCH_MONDAY) / WEEK_MS) % 2 === s.weekParity;
    case "monthly":
      return cal.getUTCDate() === s.dayOfMonth;
    case "quarterly":
      return cal.getUTCDate() === s.dayOfMonth && cal.getUTCMonth() % 3 === 0;
  }
}

/** Calcul brut, sur un planning déjà normalisé. */
function nextRunOf(s: AgentSchedule, after: Date): Date {
  const [hh, mm] = s.time.split(":").map(Number);
  const start = localParts(after, s.timezone);
  // 100 jours couvrent tous les cas (trimestriel compris).
  for (let i = 0; i <= 100; i++) {
    const cal = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    if (!matchesDay(s, cal)) continue;
    const at = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hh, mm, s.timezone);
    if (at.getTime() > after.getTime()) return at;
  }
  // Inatteignable avec un planning normalisé ; filet pour ne jamais rendre NaN.
  return new Date(after.getTime() + 24 * 3600_000);
}

/** Prochaine exécution strictement après `after`. */
export function computeNextRun(schedule: AgentSchedule, after: Date = new Date()): Date {
  return nextRunOf(normalizeSchedule(schedule), after);
}

/**
 * biweekly : les deux quinzaines possibles avec leur première exécution, la
 * plus proche d'abord. Sert au choix "Starting" du sélecteur.
 */
export function biweeklyStarts(schedule: AgentSchedule, after: Date = new Date()): { parity: 0 | 1; first: Date }[] {
  // Parité fixée avant de normaliser : normalizeSchedule n'appelle alors pas cette fonction en retour.
  const s = normalizeSchedule({ ...schedule, frequency: "biweekly", weekParity: 0 });
  return ([0, 1] as const)
    .map((parity) => ({ parity, first: nextRunOf({ ...s, weekParity: parity }, after) }))
    .sort((a, b) => a.first.getTime() - b.first.getTime());
}

// ── Libellés (UI, en anglais) ───────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function tzLabel(tz: string): string {
  return TIMEZONES.find((t) => t.id === tz)?.label ?? tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

/**
 * "Every Monday at 09:00", "Weekdays at 08:30", "Every other Monday at 09:00",
 * "Monthly on the 1st at 09:00", "Quarterly on the 1st of Jan, Apr, Jul, Oct at 09:00".
 */
export function describeSchedule(schedule: AgentSchedule, withTimezone = false): string {
  const s = normalizeSchedule(schedule);
  const at = `at ${s.time}${withTimezone ? ` (${tzLabel(s.timezone)} time)` : ""}`;
  switch (s.frequency) {
    case "daily":
      return `Every day ${at}`;
    case "weekdays":
      return `Weekdays ${at}`;
    case "weekly": {
      if (s.days.length === 1) return `Every ${WEEKDAY_LONG[s.days[0]]} ${at}`;
      if (s.days.length === 7) return `Every day ${at}`;
      return `${s.days.map((d) => WEEKDAY_SHORT[d]).join(", ")} ${at}`;
    }
    case "biweekly": {
      if (s.days.length === 1) return `Every other ${WEEKDAY_LONG[s.days[0]]} ${at}`;
      return `Every other week, ${s.days.map((d) => WEEKDAY_SHORT[d]).join(", ")} ${at}`;
    }
    case "monthly":
      return `Monthly on the ${ordinal(s.dayOfMonth)} ${at}`;
    case "quarterly":
      return `Quarterly on the ${ordinal(s.dayOfMonth)} of ${QUARTER_MONTHS.join(", ")} ${at}`;
  }
}

/** Version courte pour les cartes : "Mon · 09:00", "Daily · 08:00". */
export function shortSchedule(schedule: AgentSchedule): string {
  const s = normalizeSchedule(schedule);
  switch (s.frequency) {
    case "daily":
      return `Daily · ${s.time}`;
    case "weekdays":
      return `Weekdays · ${s.time}`;
    case "weekly":
      return `${s.days.length === 7 ? "Daily" : s.days.map((d) => WEEKDAY_SHORT[d]).join(", ")} · ${s.time}`;
    case "biweekly":
      return `Every other ${s.days.map((d) => WEEKDAY_SHORT[d]).join(", ")} · ${s.time}`;
    case "monthly":
      return `${ordinal(s.dayOfMonth)} of month · ${s.time}`;
    case "quarterly":
      return `Quarterly · ${ordinal(s.dayOfMonth)} of ${QUARTER_MONTHS.join("/")} · ${s.time}`;
  }
}

/** Nombre approximatif d'exécutions par mois (estimation de coût). */
export function runsPerMonth(schedule: AgentSchedule): number {
  const s = normalizeSchedule(schedule);
  switch (s.frequency) {
    case "daily":
      return 30;
    case "weekdays":
      return 22;
    case "weekly":
      return Math.round(s.days.length * 4.3);
    case "biweekly":
      return Math.round(s.days.length * 2.15);
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
  }
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ id: d, short: WEEKDAY_SHORT[d], long: WEEKDAY_LONG[d] }));
