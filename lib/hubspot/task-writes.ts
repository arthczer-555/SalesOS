// Tâches HubSpot écrites par le SalesOS (décision du 2026-11-27 : un lead validé
// devient contact + tâche d'appel, la carte naît à l'annonce du meeting).
//
// Même règle que lib/hubspot/deal-writes.ts : pas de ligne de journal, pas
// d'écriture. La clé de réservation (dedupe_key) rend la création idempotente :
// une validation rejouée (504 puis nouveau clic) renvoie la tâche déjà créée au
// lieu d'en créer une seconde. Un refus n'est jamais une exception.

import { hubspotFetch } from "@/lib/hubspot";
import { zonedToUtc } from "@/lib/agents/schedule";
import { stripEmDashes } from "@/lib/no-em-dash";
import { closeWrite, findWriteByDedupeKey, openWrite, type WriteTrigger } from "./write-log";

const TZ = "Europe/Paris";

/** Types d'association HUBSPOT_DEFINED au départ d'une tâche. */
export const TASK_ASSOCIATION = { contact: 204, company: 192, deal: 216 } as const;

export type TaskRefusalReason = "invalid_input" | "journal_unavailable" | "duplicate" | "hubspot_error";
export type TaskRefusal = { ok: false; reason: TaskRefusalReason; detail?: string };
export type TaskWriteResult<T extends object = object> = ({ ok: true } & T) | TaskRefusal;

/** Libellés des refus (anglais : ils remontent dans la fenêtre de validation). */
export const TASK_REFUSAL_LABELS: Record<TaskRefusalReason, string> = {
  invalid_input: "Invalid input",
  journal_unavailable: "Write log unavailable (migration not applied?), nothing was written",
  duplicate: "A call task for this lead is already being created",
  hubspot_error: "HubSpot returned an error",
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refuse = (reason: TaskRefusalReason, detail?: string): TaskRefusal => ({ ok: false, reason, ...(detail ? { detail } : {}) });

// ── Échéance ────────────────────────────────────────────────────────────────

function parisParts(d: Date): { year: number; month: number; day: number; hour: number; weekday: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), weekday: parts.weekday ?? "" };
}

/**
 * Échéance de la tâche d'appel (heure de Paris) : le jour même à 18h si la
 * validation a lieu un jour ouvré avant 16h, sinon le jour ouvré suivant à 10h.
 * Un lead entrant se rappelle vite.
 */
export function callTaskDueAt(now: Date = new Date()): Date {
  const p = parisParts(now);
  const weekday = p.weekday !== "Sat" && p.weekday !== "Sun";
  if (weekday && p.hour < 16) return zonedToUtc(p.year, p.month, p.day, 18, 0, TZ);
  // Midi UTC du jour calendaire de Paris : pas de piège au changement d'heure.
  let t = Date.UTC(p.year, p.month - 1, p.day, 12);
  do {
    t += 86_400_000;
  } while ([0, 6].includes(new Date(t).getUTCDay()));
  const next = new Date(t);
  return zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 10, 0, TZ);
}

// ── Corps HTML ─────────────────────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Lien HTML sûr pour le corps d'une tâche. */
export function htmlLink(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * Corps de tâche : hs_task_body est du texte riche, les "\n" y disparaissent.
 * Chaque morceau est soit du texte (échappé ici), soit du HTML déjà construit
 * ({ html }), par exemple un lien.
 */
export function taskBodyHtml(parts: (string | { html: string } | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string | { html: string } => !!p)
    .map((p) => (typeof p === "string" ? escapeHtml(stripEmDashes(p)) : p.html))
    .join("<br>");
}

// ── Création ───────────────────────────────────────────────────────────────

export interface CreateCallTaskInput {
  subject: string;
  /** Corps déjà en HTML (taskBodyHtml). */
  bodyHtml: string;
  ownerId: string;
  contactId: string;
  companyId?: string | null;
  dueAt: Date;
  /** Clé de réservation (ex. create_task:lead:<id>). null pour une tâche de test. */
  dedupeKey: string | null;
  triggeredBy: WriteTrigger;
  actor: string | null;
  isTest: boolean;
  leadId?: string | null;
}

async function existingTask(dedupeKey: string): Promise<TaskWriteResult<{ taskId: string; reused: boolean }> | null> {
  let row;
  try {
    row = await findWriteByDedupeKey(dedupeKey);
  } catch (e) {
    return refuse("journal_unavailable", errMsg(e));
  }
  if (!row) return null;
  if (row.status === "done" && row.objectId) return { ok: true, taskId: row.objectId, reused: true };
  // "pending" : création en cours, ou interrompue par un plantage. On ne relance
  // jamais seul : quelqu'un regarde le journal (la tâche existe peut-être).
  return refuse("duplicate", "in progress, or interrupted: check the HubSpot write log before retrying");
}

export async function createCallTask(input: CreateCallTaskInput): Promise<TaskWriteResult<{ taskId: string; reused: boolean }>> {
  const ownerId = input.ownerId?.trim();
  const contactId = input.contactId?.trim();
  const subject = stripEmDashes(input.subject.trim());
  if (!ownerId || !contactId || !subject) return refuse("invalid_input", "owner, contact and subject are required");
  if (Number.isNaN(input.dueAt.getTime())) return refuse("invalid_input", "invalid due date");

  if (input.dedupeKey) {
    const existing = await existingTask(input.dedupeKey);
    if (existing) return existing;
  }

  let log;
  try {
    log = await openWrite({
      action: "create_task",
      objectType: "tasks",
      dedupeKey: input.dedupeKey,
      triggeredBy: input.triggeredBy,
      actor: input.actor,
      mode: input.isTest ? "test" : "live",
      isTest: input.isTest,
      after: { subject, ownerId, contactId, companyId: input.companyId ?? null, dueAt: input.dueAt.toISOString() },
      leadId: input.leadId ?? null,
    });
  } catch (e) {
    return refuse("journal_unavailable", errMsg(e));
  }
  if (log.duplicate) {
    // Une autre exécution vient de réserver la même clé.
    const existing = input.dedupeKey ? await existingTask(input.dedupeKey) : null;
    return existing ?? refuse("duplicate");
  }

  const dueMs = String(input.dueAt.getTime());
  const properties: Record<string, string> = {
    hs_timestamp: input.dueAt.toISOString(),
    hs_task_subject: subject,
    hs_task_body: input.bodyHtml,
    hs_task_status: "NOT_STARTED",
    hs_task_priority: "HIGH",
    hs_task_type: "CALL",
    hubspot_owner_id: ownerId,
    // Rappel à l'échéance : HubSpot prévient l'owner (email ou notification,
    // selon ses préférences), en plus de l'email d'assignation.
    hs_task_reminders: dueMs,
  };
  const associations = [
    { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: TASK_ASSOCIATION.contact }] },
    ...(input.companyId
      ? [{ to: { id: input.companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: TASK_ASSOCIATION.company }] }]
      : []),
  ];

  try {
    const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/tasks", "POST", { properties, associations });
    const taskId = String(res.id);
    await closeWrite(log.id, { status: "done", objectId: taskId });
    return { ok: true, taskId, reused: false };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}

// ── Réassignation, association, clôture ────────────────────────────────────

export interface TaskWriteContext {
  triggeredBy: WriteTrigger;
  actor: string | null;
  isTest: boolean;
  leadId?: string | null;
}

/** Change l'owner d'une tâche (lead revalidé avec un autre commercial). */
export async function updateTaskOwner(taskId: string, ownerId: string, ctx: TaskWriteContext): Promise<TaskWriteResult> {
  if (!taskId || !ownerId) return refuse("invalid_input", "task and owner are required");
  let log;
  try {
    log = await openWrite({ action: "update_task", objectType: "tasks", objectId: taskId, triggeredBy: ctx.triggeredBy, actor: ctx.actor, isTest: ctx.isTest, after: { hubspot_owner_id: ownerId }, leadId: ctx.leadId ?? null });
  } catch (e) {
    return refuse("journal_unavailable", errMsg(e));
  }
  if (log.duplicate) return refuse("duplicate");
  try {
    await hubspotFetch(`/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, "PATCH", { properties: { hubspot_owner_id: ownerId } });
    await closeWrite(log.id, { status: "done", objectId: taskId });
    return { ok: true };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}

/** Rattache la tâche à une carte (elle apparaît alors sur la carte). Best effort. */
export async function associateTaskToDeal(taskId: string, dealId: string): Promise<void> {
  await hubspotFetch(`/crm/v4/objects/tasks/${encodeURIComponent(taskId)}/associations/default/deals/${encodeURIComponent(dealId)}`, "PUT");
}

/**
 * Marque une tâche terminée (meeting pris : l'appel est fait). Relit d'abord la
 * tâche : déjà terminée ou supprimée (404) = rien à faire.
 */
export async function completeTask(taskId: string, ctx: TaskWriteContext): Promise<TaskWriteResult<{ alreadyDone: boolean }>> {
  if (!taskId) return refuse("invalid_input", "task is required");
  try {
    const task = await hubspotFetch<{ properties?: { hs_task_status?: string | null } }>(
      `/crm/v3/objects/tasks/${encodeURIComponent(taskId)}?properties=hs_task_status`,
    );
    if (task.properties?.hs_task_status === "COMPLETED") return { ok: true, alreadyDone: true };
  } catch (e) {
    if (errMsg(e).startsWith("HubSpot 404")) return { ok: true, alreadyDone: true };
    return refuse("hubspot_error", errMsg(e));
  }
  let log;
  try {
    log = await openWrite({ action: "complete_task", objectType: "tasks", objectId: taskId, dedupeKey: `complete_task:${taskId}`, triggeredBy: ctx.triggeredBy, actor: ctx.actor, isTest: ctx.isTest, leadId: ctx.leadId ?? null });
  } catch (e) {
    return refuse("journal_unavailable", errMsg(e));
  }
  if (log.duplicate) return { ok: true, alreadyDone: true };
  try {
    await hubspotFetch(`/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, "PATCH", { properties: { hs_task_status: "COMPLETED" } });
    await closeWrite(log.id, { status: "done", objectId: taskId });
    return { ok: true, alreadyDone: false };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}
