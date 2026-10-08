// Helpers purs de la page Tasks (libellés, liens, dates relatives, reports).
import { Linkedin, ListTodo, Phone, type LucideIcon } from "lucide-react";
import type { StepKind, TaskKindFilter, TaskListItem, TaskOutcome } from "@/lib/prospecting/types";

export const TASK_KIND_META: Record<Exclude<StepKind, "email">, { label: string; verb: string; icon: LucideIcon; filter: TaskKindFilter }> = {
  linkedin_visit: { label: "LinkedIn visit", verb: "Visit their profile", icon: Linkedin, filter: "linkedin" },
  linkedin_invite: { label: "LinkedIn invite", verb: "Send a connection request", icon: Linkedin, filter: "linkedin" },
  linkedin_message: { label: "LinkedIn message", verb: "Send a LinkedIn message", icon: Linkedin, filter: "linkedin" },
  call: { label: "Call", verb: "Call them", icon: Phone, filter: "call" },
  task: { label: "Task", verb: "Custom task", icon: ListTodo, filter: "other" },
};

export function kindMeta(kind: StepKind) {
  return kind === "email" ? TASK_KIND_META.task : TASK_KIND_META[kind];
}

export function isLinkedInTask(kind: StepKind): boolean {
  return kind === "linkedin_visit" || kind === "linkedin_invite" || kind === "linkedin_message";
}

export function contactName(c: TaskListItem["contact"]): string {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "Unknown prospect";
}

export function contactSubtitle(c: TaskListItem["contact"]): string {
  if (c.title && c.company_name) return `${c.title} @ ${c.company_name}`;
  return c.title || c.company_name || c.email || "";
}

/** Profil LinkedIn, sinon recherche par nom + entreprise. */
export function linkedinHref(c: TaskListItem["contact"]): { href: string; isSearch: boolean } {
  if (c.linkedin_url) return { href: c.linkedin_url, isSearch: false };
  const q = [contactName(c), c.company_name].filter(Boolean).join(" ");
  return { href: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`, isSearch: true };
}

export function telHref(phone: string | null): string | null {
  const p = (phone ?? "").replace(/[^\d+]/g, "");
  return p.length >= 6 ? `tel:${p}` : null;
}

export interface ContentBlock {
  label: string;
  text: string;
}

/**
 * Contenu à copier selon le type d'étape. Script d'appel : le talk track et le
 * message vocal sont séparés si le texte contient une section "Voicemail".
 */
export function contentBlocks(kind: StepKind, body: string | null, subject: string | null): ContentBlock[] {
  const text = (body ?? "").trim();
  if (kind === "linkedin_visit") return [];
  if (kind === "call") {
    const blocks: ContentBlock[] = [];
    const lines = text.split(/\r?\n/);
    const vmRe = /^\s*[#*_>\-\s]*(voicemail|voice mail|message vocal|répondeur)\b/i;
    const idx = lines.findIndex((l) => vmRe.test(l));
    if (idx >= 0) {
      const head = lines[idx].replace(/^\s*[#*_>\-\s]*(voicemail|voice mail|message vocal|répondeur)\b[\s*_]*:?[\s*_]*/i, "");
      const vm = [head, ...lines.slice(idx + 1)].join("\n").trim();
      const talk = lines
        .slice(0, idx)
        .join("\n")
        .replace(/^\s*[#*_\s]*(talk track|script)\b[\s*_]*:?[\s*_]*/i, "")
        .trim();
      if (talk) blocks.push({ label: "Talk track", text: talk });
      if (vm) blocks.push({ label: "Voicemail", text: vm });
    } else if (text) {
      blocks.push({ label: "Talk track", text });
    }
    const extra = (subject ?? "").trim();
    if (extra && !blocks.some((b) => b.label === "Voicemail")) blocks.push({ label: "Voicemail", text: extra });
    return blocks;
  }
  if (!text) return [];
  const label = kind === "linkedin_invite" ? "Invitation note" : kind === "linkedin_message" ? "Message" : "Instructions";
  return [{ label, text }];
}

export const OUTCOME_LABELS: Record<TaskOutcome, string> = {
  done: "Done",
  connected: "Connected",
  no_answer: "No answer",
  voicemail: "Left voicemail",
  replied: "Replied",
  meeting_booked: "Meeting booked",
};

export function outcomesFor(kind: StepKind): TaskOutcome[] {
  if (kind === "call") return ["connected", "no_answer", "voicemail", "replied", "meeting_booked", "done"];
  return ["done", "replied", "meeting_booked"];
}

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
}

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

export function dueLabel(item: TaskListItem, now: Date = new Date()): { text: string; tone: "err" | "warn" | "neutral" | "ok" } {
  const at = item.estimatedAt ? new Date(item.estimatedAt) : null;
  if (item.bucket === "done") {
    const verb = item.touch.status === "skipped" ? "Skipped" : "Done";
    return { text: at ? `${verb} at ${timeFmt.format(at)}` : verb, tone: "ok" };
  }
  if (!at) return { text: item.bucket === "upcoming" ? "After the current task" : "Due now", tone: "neutral" };
  const diff = dayDiff(at, now);
  if (item.bucket === "overdue") {
    const days = -diff;
    return { text: days <= 1 ? "Due yesterday" : `Due ${days} days ago`, tone: "err" };
  }
  if (item.bucket === "today") {
    if (item.touch.snoozed_until && at > now) return { text: `Snoozed until ${timeFmt.format(at)}`, tone: "neutral" };
    return { text: at > now ? `Due at ${timeFmt.format(at)}` : "Due today", tone: "warn" };
  }
  const prefix = item.touch.status === "due" ? "Snoozed until" : "Expected";
  if (diff === 0) return { text: `${prefix} today, ${timeFmt.format(at)}`, tone: "neutral" };
  if (diff === 1) return { text: `${prefix} tomorrow`, tone: "neutral" };
  return { text: `${prefix} ${dayFmt.format(at)}`, tone: "neutral" };
}

export type SnoozePreset = "1d" | "3d" | "next_week";

export const SNOOZE_LABELS: Record<SnoozePreset, string> = {
  "1d": "Tomorrow",
  "3d": "In 3 days",
  next_week: "Next week",
};

/** Reports à 9:00 (heure locale du navigateur). */
export function snoozeUntil(preset: SnoozePreset, now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  if (preset === "1d") d.setDate(d.getDate() + 1);
  else if (preset === "3d") d.setDate(d.getDate() + 3);
  else {
    const dow = d.getDay(); // 0 = dimanche
    const toMonday = ((8 - dow) % 7) || 7;
    d.setDate(d.getDate() + toMonday);
  }
  return d;
}

export function snoozeHint(preset: SnoozePreset, now: Date = new Date()): string {
  return dayFmt.format(snoozeUntil(preset, now));
}
