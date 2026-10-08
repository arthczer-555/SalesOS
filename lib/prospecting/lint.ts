// Linter des messages et des séquences, basé sur les benchmarks documentés dans
// __documentation/prospecting-playbook.md. Module pur, partagé client/serveur.
// Niveau "error" = bloquant (approbation et envoi impossibles).
import { stepDayOffsets } from "./settings";
import type { LintIssue, SendWindow, SequenceHealth, StepDraft, StepKind } from "./types";
import { findUnresolved } from "./variables";

const FILLER_PHRASES = [
  "just checking in",
  "just following up",
  "following up on my",
  "bumping this",
  "bump this",
  "circling back",
  "touching base",
  "any update",
  "did you get a chance",
  "did you have a chance",
  "je me permets de vous relancer",
  "petite relance",
  "je reviens vers vous",
  "avez-vous eu le temps",
];

const SPAM_WORDS = [
  "free",
  "guarantee",
  "guaranteed",
  "no obligation",
  "risk-free",
  "risk free",
  "100%",
  "act now",
  "urgent",
  "limited time",
  "click here",
  "best price",
  "gratuit",
  "garanti",
  "offre limitée",
];

/** Texte sans les lignes citées (> ...) ni le bloc "On ... wrote:". */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^(On|Le) .+(wrote|a écrit)\s*:\s*$/i.test(l.trim())) break;
    out.push(l);
  }
  return out.join("\n");
}

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return stripQuoted(text)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface MessageLintInput {
  kind: StepKind;
  position: number;
  /** Email en réponse dans le thread (pas de sujet propre). */
  isReply: boolean;
  /** Première étape email de la séquence. */
  isFirstEmail: boolean;
  subject: string | null | undefined;
  body: string | null | undefined;
  stepId?: string;
}

export function lintMessage(input: MessageLintInput): LintIssue[] {
  const issues: LintIssue[] = [];
  const push = (level: LintIssue["level"], code: string, message: string) =>
    issues.push({ level, code, message, stepId: input.stepId, position: input.position });
  const body = (input.body ?? "").trim();
  const subject = (input.subject ?? "").trim();

  if (input.kind === "linkedin_visit") return issues;

  if (!body) {
    push("error", "empty_body", "Message is empty.");
    return issues;
  }

  const unresolved = [...findUnresolved(body), ...findUnresolved(subject)];
  if (unresolved.length) {
    push("error", "unresolved_variable", `Unresolved placeholder: ${Array.from(new Set(unresolved)).join(", ")}.`);
  }

  const lower = stripQuoted(body).toLowerCase();

  if (input.kind === "linkedin_invite") {
    if (body.length > 300) push("error", "linkedin_invite_too_long", `Invite note is ${body.length} characters. LinkedIn caps notes at 300.`);
    else if (body.length > 200) push("warn", "linkedin_invite_long", `Invite note is ${body.length} characters. Free LinkedIn accounts cap notes at 200.`);
    return issues;
  }
  if (input.kind === "linkedin_message") {
    if (body.length > 600) push("warn", "linkedin_message_long", `LinkedIn message is ${body.length} characters. Keep it under 400 to read like a DM.`);
    return issues;
  }
  if (input.kind === "call" || input.kind === "task") return issues;

  // ── Emails ──
  if (!input.isReply && !subject) push("error", "missing_subject", "Email has no subject.");

  const words = wordCount(body);
  if (input.isFirstEmail) {
    if (words > 160) push("warn", "too_long", `First email is ${words} words. Top performers stay under 90.`);
    else if (words > 120) push("warn", "long", `First email is ${words} words. Aim for 50 to 120.`);
  } else if (words > 120) {
    push("warn", "too_long", `Follow-up is ${words} words. Follow-ups work best under 90.`);
  } else if (words > 90) {
    push("info", "long", `Follow-up is ${words} words. Shorter follow-ups get more replies.`);
  }

  if (!input.isReply && subject) {
    if (subject.length > 60) push("warn", "subject_long", `Subject is ${subject.length} characters. Keep it under 60 (ideally 2 to 5 words).`);
    if (/!/.test(subject)) push("warn", "subject_exclamation", "Avoid exclamation marks in subjects (spam signal).");
    if (/\b[A-Z]{4,}\b/.test(subject)) push("warn", "subject_caps", "Avoid ALL CAPS words in subjects.");
  }

  const filler = FILLER_PHRASES.find((p) => lower.includes(p));
  if (filler) push("warn", "filler_followup", `"${filler}" adds no value. Bring a new angle instead.`);

  const links = (stripQuoted(body).match(/https?:\/\/\S+/g) ?? []).length;
  if (input.isFirstEmail && links > 0) push("warn", "link_first_email", "Links in a first cold email hurt deliverability. Save them for a follow-up.");
  else if (links > 1) push("warn", "many_links", `${links} links. Keep at most one.`);

  const questions = (stripQuoted(body).match(/\?/g) ?? []).length;
  if (questions > 2) push("warn", "multiple_ctas", `${questions} questions. Keep one clear ask.`);

  const spam = SPAM_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(lower + " " + subject.toLowerCase()));
  if (spam.length) push("warn", "spam_words", `Spam-sensitive words: ${spam.slice(0, 3).join(", ")}.`);

  if (/[\u2014\u2013]/.test(body + subject)) push("info", "long_dash", "Long dashes are replaced by a short hyphen when sending.");

  return issues;
}

export function hasBlockingIssue(issues: LintIssue[] | null | undefined): boolean {
  return (issues ?? []).some((i) => i.level === "error");
}

export interface SequenceLintStep extends StepDraft {
  id?: string;
}

export function lintSequence(steps: SequenceLintStep[], window?: SendWindow): SequenceHealth {
  const issues: LintIssue[] = [];
  const push = (level: LintIssue["level"], code: string, message: string, step?: SequenceLintStep, index?: number) =>
    issues.push({ level, code, message, stepId: step?.id, position: index !== undefined ? index + 1 : undefined });

  if (steps.length === 0) {
    push("error", "empty_sequence", "Add at least one step.");
    return { score: 0, issues };
  }

  const emailIdx = steps.map((s, i) => (s.kind === "email" ? i : -1)).filter((i) => i >= 0);
  if (emailIdx.length === 0) push("error", "no_email", "A sequence needs at least one email step.");

  const offsets = stepDayOffsets(steps);
  const totalDays = offsets[offsets.length - 1] ?? 0;
  const touches = steps.filter((s) => s.kind !== "linkedin_visit").length;

  if (touches < 3) push("warn", "too_few_steps", "Short sequence. About 42% of replies come from follow-ups: aim for 4 to 7 touches.");
  if (steps.length > 10) push("warn", "too_many_steps", "More than 10 steps. Beyond 9 touches, unsubscribes outweigh new replies.");
  if (steps.length >= 3 && totalDays < 7) push("warn", "too_compressed", `The whole sequence fits in ${totalDays} days. Spread it over 10 to 25 days.`);
  if (totalDays > 20) push("warn", "too_long", `The sequence lasts ${totalDays} sending days. Most replies arrive within 3 weeks.`);

  steps.forEach((s, i) => {
    if (s.kind === "email" && s.config.mode === "template" && !s.config.template.body.trim()) {
      push("error", "empty_template", `Step ${i + 1}: template mode needs a body.`, s, i);
    }
    if (s.kind === "email" && s.threadMode === "reply" && !emailIdx.some((j) => j < i)) {
      push("warn", "reply_without_thread", `Step ${i + 1} replies in a thread but no email comes before it. It will start a new thread.`, s, i);
    }
  });

  // Deux emails trop rapprochés.
  for (let k = 1; k < emailIdx.length; k++) {
    const gap = offsets[emailIdx[k]] - offsets[emailIdx[k - 1]];
    if (gap < 2) {
      const s = steps[emailIdx[k]];
      push("warn", "emails_too_close", `Step ${emailIdx[k] + 1} comes ${gap} day(s) after the previous email. Leave at least 2 days.`, s, emailIdx[k]);
    }
  }

  // Première relance email hors thread.
  if (emailIdx.length >= 2) {
    const s = steps[emailIdx[1]];
    if (s.threadMode !== "reply") {
      push("info", "first_followup_new_thread", "Sending the first follow-up as a reply in the same thread lifts replies by about 30%.", s, emailIdx[1]);
    }
  }

  // Angles répétés (mode IA).
  const seen = new Map<string, number>();
  steps.forEach((s, i) => {
    if (s.kind !== "email" || s.config.mode !== "ai" || s.config.angle === "custom") return;
    const prev = seen.get(s.config.angle);
    if (prev !== undefined) push("warn", "repeated_angle", `Steps ${prev + 1} and ${i + 1} use the same angle. Each touch should bring something new.`, s, i);
    else seen.set(s.config.angle, i);
  });

  if (!steps.some((s) => s.kind === "linkedin_invite" || s.kind === "linkedin_message" || s.kind === "linkedin_visit")) {
    push("info", "no_linkedin", "Adding a LinkedIn touch 1 to 2 days after the first email makes outreach feel human.");
  }

  const last = steps[steps.length - 1];
  if (steps.length >= 4 && !(last.kind === "email" && last.config.angle === "breakup")) {
    push("info", "no_breakup", "End with a short break-up email: it often triggers the last wave of replies.");
  }

  if (window && (window.days.includes(5) || window.days.includes(6) || window.days.includes(7))) {
    push("info", "friday_weekend", "Fridays and weekends see more auto-replies and fewer answers.");
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warn").length;
  const infos = issues.filter((i) => i.level === "info").length;
  const score = Math.max(0, Math.min(100, 100 - errors * 30 - warns * 8 - infos * 3));
  return { score, issues };
}
