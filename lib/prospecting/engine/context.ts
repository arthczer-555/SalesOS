// Contexte d'exécution partagé par les modules du moteur (budget de temps,
// mode d'envoi, simulation) et types de résultat du tick.
import type { SendMode } from "../store/mailbox";
import type { StepKind, SyncSummary } from "../types";

export interface EngineContext {
  /** Instant (epoch ms) au-delà duquel on n'entame plus de travail. */
  deadline: number;
  /** Simulation : aucune écriture, aucun envoi, on retourne le plan. */
  dryRun: boolean;
  sendMode: SendMode;
  /** Base URL pour re-dispatcher les jobs background. */
  origin: string;
}

export function timeLeft(ctx: EngineContext): number {
  return ctx.deadline - Date.now();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function defaultOrigin(): string {
  return process.env.URL ?? process.env.SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export type PlannedActionKind = "send_email" | "create_task" | "skip_no_email" | "complete" | "outdated" | "held";

/** Action prévue (dryRun) ou retenue, pour le diagnostic admin. */
export interface PlannedAction {
  enrollmentId: string;
  campaignId: string;
  contact: string;
  position: number | null;
  kind: StepKind | null;
  action: PlannedActionKind;
  reason?: string;
}

export interface SendDueResult {
  sent: number;
  tasksCreated: number;
  completed: number;
  skippedNoEmail: number;
  blocked: number;
  failed: number;
  /** Prospects dus mais retenus (caps, mode d'envoi, approbation, contenu obsolète). */
  held: number;
  candidates: number;
  budget: number;
  capLeft: number;
  stoppedReason: string | null;
  plan: PlannedAction[];
  errors: string[];
}

export function emptySendDueResult(): SendDueResult {
  return {
    sent: 0,
    tasksCreated: 0,
    completed: 0,
    skippedNoEmail: 0,
    blocked: 0,
    failed: 0,
    held: 0,
    candidates: 0,
    budget: 0,
    capLeft: 0,
    stoppedReason: null,
    plan: [],
    errors: [],
  };
}

export interface MailboxTickResult {
  userId: string;
  mailboxId: string;
  email: string | null;
  skipped: string | null;
  recovered: number;
  sync: SyncSummary | null;
  send: SendDueResult | null;
  errors: string[];
}

export interface TickSummary {
  ok: boolean;
  dryRun: boolean;
  sendMode: SendMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mailboxes: number;
  processed: number;
  sent: number;
  tasksCreated: number;
  completed: number;
  replies: number;
  bounces: number;
  jobsRecovered: number;
  errors: string[];
  results: MailboxTickResult[];
}

export function emptySyncSummary(mode: SyncSummary["mode"] = "skipped"): SyncSummary {
  return { mode, scanned: 0, replies: 0, autoReplies: 0, bounces: 0, colleagueReplies: 0, manualReplies: 0, error: null };
}
