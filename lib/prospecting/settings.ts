// Normalisation des réglages de campagne et de la config des étapes. Module pur,
// partagé client/serveur : toute valeur venant de la DB ou d'une requête passe
// par ici, donc le reste du code peut faire confiance aux types.
import type { AngleKey, CampaignSettings, SendWindow, StepConfig, StepDraft, StepKind, StepLength, StepRow, ThreadMode } from "./types";

export const DEFAULT_TIMEZONE = "Europe/Paris";

export const DEFAULT_WINDOW: SendWindow = {
  timezone: DEFAULT_TIMEZONE,
  days: [1, 2, 3, 4], // lun-jeu : le vendredi concentre les auto-réponses
  start: "08:30",
  end: "17:30",
};

export const DEFAULT_SETTINGS: CampaignSettings = {
  window: DEFAULT_WINDOW,
  startDate: null,
  newLeadsPerDay: 15,
  maxEmailsPerDay: 30,
  requireApproval: true,
  stopOnCompanyReply: true,
  pauseOnOoo: true,
  skipIfContactedWithinDays: 30,
  sameCompanyStagger: true,
  signature: "all",
  quotePrevious: true,
  softOptOut: true,
  hubspotLogEmails: true,
  hubspotCreateContacts: true,
};

export const MAILBOX_HARD_MAX = 100;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeWindow(raw: unknown): SendWindow {
  const w = (raw && typeof raw === "object" ? raw : {}) as Partial<SendWindow>;
  const timezone = typeof w.timezone === "string" && isValidTimezone(w.timezone) ? w.timezone : DEFAULT_WINDOW.timezone;
  const days = Array.isArray(w.days)
    ? Array.from(new Set(w.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))).sort()
    : DEFAULT_WINDOW.days;
  let start = typeof w.start === "string" && HHMM.test(w.start) ? w.start : DEFAULT_WINDOW.start;
  let end = typeof w.end === "string" && HHMM.test(w.end) ? w.end : DEFAULT_WINDOW.end;
  if (start >= end) {
    start = DEFAULT_WINDOW.start;
    end = DEFAULT_WINDOW.end;
  }
  return { timezone, days: days.length ? days : DEFAULT_WINDOW.days, start, end };
}

export function normalizeSettings(raw: unknown): CampaignSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<CampaignSettings>;
  const d = DEFAULT_SETTINGS;
  return {
    window: normalizeWindow(s.window),
    startDate: typeof s.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.startDate) ? s.startDate : null,
    newLeadsPerDay: clampInt(s.newLeadsPerDay, 1, MAILBOX_HARD_MAX, d.newLeadsPerDay),
    maxEmailsPerDay: clampInt(s.maxEmailsPerDay, 1, MAILBOX_HARD_MAX, d.maxEmailsPerDay),
    requireApproval: bool(s.requireApproval, d.requireApproval),
    stopOnCompanyReply: bool(s.stopOnCompanyReply, d.stopOnCompanyReply),
    pauseOnOoo: bool(s.pauseOnOoo, d.pauseOnOoo),
    skipIfContactedWithinDays: clampInt(s.skipIfContactedWithinDays, 0, 365, d.skipIfContactedWithinDays),
    sameCompanyStagger: bool(s.sameCompanyStagger, d.sameCompanyStagger),
    signature: s.signature === "first" || s.signature === "none" || s.signature === "all" ? s.signature : d.signature,
    quotePrevious: bool(s.quotePrevious, d.quotePrevious),
    softOptOut: bool(s.softOptOut, d.softOptOut),
    hubspotLogEmails: bool(s.hubspotLogEmails, d.hubspotLogEmails),
    hubspotCreateContacts: bool(s.hubspotCreateContacts, d.hubspotCreateContacts),
  };
}

// ── Étapes ──────────────────────────────────────────────────────────────────

export const STEP_KINDS: StepKind[] = ["email", "linkedin_visit", "linkedin_invite", "linkedin_message", "call", "task"];
export const ANGLE_KEYS: AngleKey[] = [
  "problem",
  "timeline",
  "numbers",
  "social_proof",
  "insight",
  "trigger",
  "referral",
  "breakup",
  "custom",
];

export function isManualKind(kind: StepKind): boolean {
  return kind !== "email";
}

export function isLinkedInKind(kind: StepKind): boolean {
  return kind === "linkedin_visit" || kind === "linkedin_invite" || kind === "linkedin_message";
}

/** L'étape a-t-elle un contenu à écrire (la visite de profil n'en a pas). */
export function stepHasContent(kind: StepKind): boolean {
  return kind !== "linkedin_visit";
}

export const DEFAULT_STEP_CONFIG: StepConfig = {
  mode: "ai",
  angle: "problem",
  instructions: "",
  template: { subject: "", body: "" },
  length: "short",
  cta: "",
  waitForCompletion: false,
};

export function normalizeStepConfig(raw: unknown): StepConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<StepConfig>;
  const tpl = (c.template && typeof c.template === "object" ? c.template : {}) as Partial<StepConfig["template"]>;
  const length: StepLength = c.length === "standard" || c.length === "long" ? c.length : "short";
  return {
    mode: c.mode === "template" ? "template" : "ai",
    angle: ANGLE_KEYS.includes(c.angle as AngleKey) ? (c.angle as AngleKey) : DEFAULT_STEP_CONFIG.angle,
    instructions: typeof c.instructions === "string" ? c.instructions.slice(0, 4000) : "",
    template: {
      subject: typeof tpl.subject === "string" ? tpl.subject.slice(0, 300) : "",
      body: typeof tpl.body === "string" ? tpl.body.slice(0, 8000) : "",
    },
    length,
    cta: typeof c.cta === "string" ? c.cta.slice(0, 300) : "",
    waitForCompletion: bool(c.waitForCompletion, false),
  };
}

export function normalizeStepDraft(raw: unknown, index: number): StepDraft {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<StepDraft> & { delay_days?: number; thread_mode?: ThreadMode };
  const kind: StepKind = STEP_KINDS.includes(s.kind as StepKind) ? (s.kind as StepKind) : "email";
  const threadRaw = s.threadMode ?? s.thread_mode;
  return {
    id: typeof s.id === "string" ? s.id : undefined,
    kind,
    delayDays: index === 0 ? 0 : clampInt(s.delayDays ?? s.delay_days, 0, 60, 3),
    // Seul un email peut répondre dans un thread ; le 1er email ouvre forcément un thread.
    threadMode: kind === "email" && threadRaw === "reply" ? "reply" : "new",
    config: normalizeStepConfig(s.config),
  };
}

/** Jour (relatif, en jours d'envoi) de chaque étape : J0, J3, J7... */
export function stepDayOffsets(steps: { delayDays: number }[]): number[] {
  const out: number[] = [];
  let acc = 0;
  steps.forEach((s, i) => {
    acc += i === 0 ? 0 : s.delayDays;
    out.push(acc);
  });
  return out;
}

/** Signature de contenu d'une étape : change => les touches générées sont obsolètes. */
export function stepContentKey(step: { kind: StepKind; threadMode: ThreadMode; config: StepConfig }): string {
  const c = step.config;
  return JSON.stringify([step.kind, step.threadMode, c.mode, c.angle, c.instructions, c.template, c.length, c.cta]);
}

/** Ligne DB -> brouillon d'étape (éditeur, lint). */
export function stepRowToDraft(s: StepRow): StepDraft {
  return { id: s.id, kind: s.kind, delayDays: s.delay_days, threadMode: s.thread_mode, config: s.config };
}
