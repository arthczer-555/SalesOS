// Avancement et arrêt des séquences, partagés par le tick (envoi, tâches),
// la synchro (réponses, bounces) et la complétion de tâches.
//
// Règle : les champs de progression (current_position, started_at,
// last_activity_at) sont toujours écrits, mais le statut et next_run_at ne le
// sont que si l'enrollment est encore `active` (une action concurrente du rep,
// pause ou stop, ne doit jamais être écrasée par le moteur).
import { db } from "@/lib/db";
import { computeNextRunAt } from "../schedule";
import { logEvent } from "../store/events";
import { nowIso } from "../store/util";
import type { CampaignRow, ContactStatus, EnrollmentOutcome, EnrollmentRow, EnrollmentStatus, StepRow, TouchStatus } from "../types";
import { CANCELABLE_TOUCH_STATUSES, pickNextStep } from "./next-step";

export type EnrollmentRef = Pick<EnrollmentRow, "id" | "campaign_id" | "contact_id" | "user_id">;

export interface AdvanceInput {
  enrollment: Pick<EnrollmentRow, "id" | "campaign_id" | "contact_id" | "user_id" | "started_at">;
  campaign: CampaignRow;
  steps: StepRow[];
  /** Touches de l'enrollment, état À JOUR (l'étape exécutée déjà dans son nouveau statut). */
  touches: { step_id: string; status: TouchStatus }[];
  executedAt: Date;
  executedPosition: number;
  /** Étape manuelle "Wait until done" : la suite attend la complétion de la tâche. */
  waitForCompletion?: boolean;
}

export interface AdvanceResult {
  completed: boolean;
  nextRunAt: string | null;
}

/** Après l'exécution d'une étape : planifie la suivante ou termine la séquence. */
export async function advanceAfterExecution(input: AdvanceInput): Promise<AdvanceResult> {
  const { enrollment, campaign, steps, touches, executedAt } = input;
  const at = executedAt.toISOString();
  const progress = {
    current_position: input.executedPosition,
    started_at: enrollment.started_at ?? at,
    last_activity_at: at,
    updated_at: nowIso(),
  };

  const next = pickNextStep(steps, touches);
  let status: EnrollmentStatus = "active";
  let nextRunAt: string | null;
  if (input.waitForCompletion) {
    nextRunAt = null;
  } else if (!next) {
    status = "completed";
    nextRunAt = null;
  } else {
    nextRunAt = computeNextRunAt(executedAt, next.step.delay_days, campaign.settings.window).toISOString();
  }

  const { data } = await db
    .from("prospecting_enrollments")
    .update({ ...progress, status, next_run_at: nextRunAt })
    .eq("id", enrollment.id)
    .eq("status", "active")
    .select("id");
  if (!data?.length) {
    // Statut changé entre-temps (pause, stop, réponse) : on garde la trace de
    // l'exécution sans toucher au statut choisi ailleurs.
    await db.from("prospecting_enrollments").update(progress).eq("id", enrollment.id);
    return { completed: false, nextRunAt: null };
  }
  if (status === "completed") {
    await logEvent({
      type: "completed",
      userId: enrollment.user_id,
      campaignId: enrollment.campaign_id,
      enrollmentId: enrollment.id,
      contactId: enrollment.contact_id,
    });
  }
  return { completed: status === "completed", nextRunAt };
}

/** Plus aucune étape à exécuter : termine la séquence. */
export async function completeEnrollment(enrollment: EnrollmentRef): Promise<boolean> {
  const { data } = await db
    .from("prospecting_enrollments")
    .update({ status: "completed", next_run_at: null, updated_at: nowIso() })
    .eq("id", enrollment.id)
    .eq("status", "active")
    .select("id");
  if (!data?.length) return false;
  await logEvent({
    type: "completed",
    userId: enrollment.user_id,
    campaignId: enrollment.campaign_id,
    enrollmentId: enrollment.id,
    contactId: enrollment.contact_id,
  });
  return true;
}

/** Annule les étapes restantes (brouillons, approuvées, tâches dues). */
export async function cancelPendingTouches(enrollmentId: string, reason: string): Promise<number> {
  const { data } = await db
    .from("prospecting_touches")
    .update({ status: "canceled", task_note: reason, updated_at: nowIso() })
    .eq("enrollment_id", enrollmentId)
    .in("status", CANCELABLE_TOUCH_STATUSES)
    .select("id");
  return data?.length ?? 0;
}

export interface StopInput {
  enrollment: EnrollmentRef;
  status: EnrollmentStatus;
  /** Statuts depuis lesquels l'arrêt s'applique (défaut : séquence encore vivante). */
  fromStatuses?: EnrollmentStatus[];
  stopReason?: string | null;
  error?: string | null;
  outcome?: EnrollmentOutcome | null;
  repliedAt?: string | null;
  eventType: string;
  eventData?: Record<string, unknown>;
  cancelReason?: string;
}

/**
 * Arrête une séquence (réponse, bounce, stop entreprise, erreur) : statut,
 * next_run_at null, étapes restantes annulées, événement. Retourne false si
 * l'enrollment n'était pas dans un statut concerné.
 */
export async function stopSequence(input: StopInput): Promise<boolean> {
  const patch: Record<string, unknown> = { status: input.status, next_run_at: null, updated_at: nowIso() };
  if (input.stopReason !== undefined) patch.stop_reason = input.stopReason;
  if (input.error !== undefined) patch.error = input.error;
  if (input.outcome) patch.outcome = input.outcome;
  if (input.repliedAt) patch.last_activity_at = input.repliedAt;
  const { data } = await db
    .from("prospecting_enrollments")
    .update(patch)
    .eq("id", input.enrollment.id)
    .in("status", input.fromStatuses ?? ["active", "paused"])
    .select("id, replied_at");
  if (!data?.length) return false;
  if (input.repliedAt && !(data[0] as { replied_at: string | null }).replied_at) {
    await db.from("prospecting_enrollments").update({ replied_at: input.repliedAt }).eq("id", input.enrollment.id).is("replied_at", null);
  }
  await cancelPendingTouches(input.enrollment.id, input.cancelReason ?? `Sequence ${input.status}`);
  await logEvent({
    type: input.eventType,
    userId: input.enrollment.user_id,
    campaignId: input.enrollment.campaign_id,
    enrollmentId: input.enrollment.id,
    contactId: input.enrollment.contact_id,
    data: input.eventData ?? {},
  });
  return true;
}

/** Statut du contact (registre d'équipe) sans écraser un statut plus "fort". */
export async function setContactStatus(contactId: string, status: ContactStatus, fromStatuses: ContactStatus[]): Promise<void> {
  await db
    .from("prospecting_contacts")
    .update({ status, updated_at: nowIso() })
    .eq("id", contactId)
    .in("status", fromStatuses);
}

/** Reporte la prochaine évaluation d'un prospect bloqué (évite de le réévaluer à chaque tick). */
export async function postponeEnrollment(enrollmentId: string, minutes: number): Promise<void> {
  await db
    .from("prospecting_enrollments")
    .update({ next_run_at: new Date(Date.now() + minutes * 60_000).toISOString(), updated_at: nowIso() })
    .eq("id", enrollmentId)
    .eq("status", "active");
}

/**
 * Reprise des pauses temporisées échues (absence / OOO, ou toute pause posée
 * avec une date de fin). Une pause manuelle n'a pas de paused_until : jamais
 * reprise ici.
 */
export async function resumeTimedPauses(userId: string): Promise<number> {
  const now = nowIso();
  const { data, error } = await db
    .from("prospecting_enrollments")
    .update({ status: "active", paused_until: null, pause_reason: null, updated_at: now })
    .eq("user_id", userId)
    .eq("status", "paused")
    .not("paused_until", "is", null)
    .lte("paused_until", now)
    .select("id, campaign_id, contact_id, user_id, next_run_at");
  if (error) {
    console.error("[prospecting] resume timed pauses failed:", error.message);
    return 0;
  }
  // next_run_at est conservé : null = la séquence attend une tâche "Wait until done".
  const rows = (data ?? []) as (EnrollmentRef & { next_run_at: string | null })[];
  for (const e of rows) {
    await logEvent({
      type: "resumed",
      userId: e.user_id,
      campaignId: e.campaign_id,
      enrollmentId: e.id,
      contactId: e.contact_id,
      data: { reason: "pause_ended" },
    });
  }
  return rows.length;
}
