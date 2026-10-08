// Actions sur les inscriptions (prospect x campagne) : approbation, pause,
// reprise, arrêt, issue (meeting, pas intéressé), saut d'étape.
import { db } from "@/lib/db";
import { lintMessage, hasBlockingIssue } from "../lint";
import { nextWindowOpen } from "../schedule";
import type { CampaignRow, ContactStatus, EnrollmentOutcome, EnrollmentRow, StepRow, TouchRow } from "../types";
import { activateEnrollments } from "./activation";
import { getCampaign, listSteps } from "./campaigns";
import { logEvent } from "./events";
import { nowIso } from "./util";

export type EnrollmentAction =
  | "approve"
  | "approve_ready"
  | "unapprove"
  | "pause"
  | "resume"
  | "stop"
  | "remove"
  | "mark_replied"
  | "meeting_booked"
  | "not_interested"
  | "skip_step";

export const ENROLLMENT_ACTIONS: EnrollmentAction[] = [
  "approve",
  "approve_ready",
  "unapprove",
  "pause",
  "resume",
  "stop",
  "remove",
  "mark_replied",
  "meeting_booked",
  "not_interested",
  "skip_step",
];

const EXECUTED = new Set(["sent", "done", "due", "skipped", "canceled", "failed", "sending"]);

export class EnrollmentActionError extends Error {}

/** Vrai si les messages générés n'ont aucune erreur bloquante. */
export function touchesAreClean(touches: TouchRow[], steps: StepRow[]): boolean {
  const firstEmail = steps.find((s) => s.kind === "email")?.id;
  return touches.every((t) => {
    if (EXECUTED.has(t.status)) return true;
    const step = steps.find((s) => s.id === t.step_id);
    if (!step) return true;
    const issues = lintMessage({
      kind: step.kind,
      position: step.position,
      isReply: step.kind === "email" && step.thread_mode === "reply",
      isFirstEmail: step.id === firstEmail,
      subject: t.subject,
      body: t.body,
    });
    return !hasBlockingIssue(issues);
  });
}

async function cancelRemainingTouches(enrollmentId: string): Promise<void> {
  await db
    .from("prospecting_touches")
    .update({ status: "canceled", updated_at: nowIso() })
    .eq("enrollment_id", enrollmentId)
    .in("status", ["draft", "approved", "due"]);
}

async function setContactStatus(contactId: string, status: ContactStatus): Promise<void> {
  await db.from("prospecting_contacts").update({ status, updated_at: nowIso() }).eq("id", contactId);
}

async function finish(
  e: EnrollmentRow,
  patch: Partial<EnrollmentRow>,
  contactStatus: ContactStatus | null,
  userId: string,
  eventType: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const live = e.status === "active" || e.status === "paused" || e.status === "pending";
  await db
    .from("prospecting_enrollments")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", e.id);
  if (live && (patch.status === "replied" || patch.status === "stopped")) await cancelRemainingTouches(e.id);
  if (contactStatus) await setContactStatus(e.contact_id, contactStatus);
  await logEvent({ type: eventType, userId, campaignId: e.campaign_id, enrollmentId: e.id, contactId: e.contact_id, data });
}

/** Applique une action à des inscriptions du user. Retourne le nombre mis à jour + erreurs lisibles. */
export async function applyEnrollmentAction(
  userId: string,
  ids: string[],
  action: EnrollmentAction,
): Promise<{ updated: number; errors: string[] }> {
  if (ids.length === 0) return { updated: 0, errors: [] };
  const { data, error } = await db.from("prospecting_enrollments").select("*").in("id", ids.slice(0, 1000)).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EnrollmentRow[];
  const errors: string[] = [];
  let updated = 0;
  const now = nowIso();

  const campaigns = new Map<string, CampaignRow | null>();
  const stepsByCampaign = new Map<string, StepRow[]>();
  const campaignOf = async (id: string) => {
    if (!campaigns.has(id)) campaigns.set(id, await getCampaign(id));
    return campaigns.get(id) ?? null;
  };
  const stepsOf = async (id: string) => {
    if (!stepsByCampaign.has(id)) stepsByCampaign.set(id, await listSteps(id));
    return stepsByCampaign.get(id) ?? [];
  };

  const approvedPerCampaign = new Map<string, string[]>();

  for (const e of rows) {
    switch (action) {
      case "approve":
      case "approve_ready": {
        if (e.approved_at) continue;
        if (e.content_status !== "ready") {
          if (action === "approve") errors.push("Some prospects have no ready messages yet.");
          continue;
        }
        const { data: touches } = await db.from("prospecting_touches").select("*").eq("enrollment_id", e.id);
        const steps = await stepsOf(e.campaign_id);
        if (!touchesAreClean((touches ?? []) as TouchRow[], steps)) {
          if (action === "approve") errors.push("Fix the blocking issues before approving.");
          continue;
        }
        await db.from("prospecting_enrollments").update({ approved_at: now, approved_by: userId, updated_at: now }).eq("id", e.id);
        await db.from("prospecting_touches").update({ status: "approved", updated_at: now }).eq("enrollment_id", e.id).eq("status", "draft");
        await logEvent({ type: "approved", userId, campaignId: e.campaign_id, enrollmentId: e.id, contactId: e.contact_id });
        approvedPerCampaign.set(e.campaign_id, [...(approvedPerCampaign.get(e.campaign_id) ?? []), e.id]);
        updated++;
        break;
      }
      case "unapprove": {
        if (!e.approved_at) continue;
        if (e.status !== "pending") {
          errors.push("Prospects already in sequence can be paused, not unapproved.");
          continue;
        }
        await db.from("prospecting_enrollments").update({ approved_at: null, approved_by: null, updated_at: now }).eq("id", e.id);
        await db.from("prospecting_touches").update({ status: "draft", updated_at: now }).eq("enrollment_id", e.id).eq("status", "approved");
        updated++;
        break;
      }
      case "pause": {
        if (e.status !== "active") continue;
        // paused_until null : une pause manuelle ne reprend jamais toute seule.
        await finish(e, { status: "paused", pause_reason: "manual", paused_until: null }, null, userId, "paused");
        updated++;
        break;
      }
      case "resume": {
        if (e.status !== "paused") continue;
        const c = await campaignOf(e.campaign_id);
        const base = e.next_run_at && new Date(e.next_run_at) > new Date() ? new Date(e.next_run_at) : new Date();
        const next = c ? nextWindowOpen(base, c.settings.window).toISOString() : now;
        const { error: upErr } = await db
          .from("prospecting_enrollments")
          .update({ status: "active", pause_reason: null, paused_until: null, next_run_at: next, updated_at: now })
          .eq("id", e.id);
        if (upErr) {
          errors.push("This prospect is already in another active sequence.");
          continue;
        }
        await logEvent({ type: "resumed", userId, campaignId: e.campaign_id, enrollmentId: e.id, contactId: e.contact_id });
        updated++;
        break;
      }
      case "stop": {
        if (!["pending", "active", "paused", "error"].includes(e.status)) continue;
        await finish(e, { status: "stopped", stop_reason: "manual", next_run_at: null }, null, userId, "stopped", { reason: "manual" });
        updated++;
        break;
      }
      case "remove": {
        const { count } = await db
          .from("prospecting_touches")
          .select("id", { count: "exact", head: true })
          .eq("enrollment_id", e.id)
          .in("status", ["sent", "done", "sending"]);
        if ((count ?? 0) > 0) {
          await finish(e, { status: "stopped", stop_reason: "removed", next_run_at: null }, null, userId, "stopped", { reason: "removed" });
        } else {
          await db.from("prospecting_enrollments").delete().eq("id", e.id);
        }
        updated++;
        break;
      }
      case "mark_replied": {
        if (e.replied_at) continue;
        await finish(e, { status: "replied", replied_at: now, next_run_at: null }, "replied", userId, "replied", { manual: true });
        updated++;
        break;
      }
      case "meeting_booked":
      case "not_interested": {
        const outcome: EnrollmentOutcome = action === "meeting_booked" ? "meeting_booked" : "not_interested";
        const live = ["pending", "active", "paused"].includes(e.status);
        await finish(
          e,
          { outcome, ...(live ? { status: e.replied_at ? "replied" : "stopped", stop_reason: outcome, next_run_at: null } : {}) },
          action === "meeting_booked" ? "meeting" : "not_interested",
          userId,
          action === "meeting_booked" ? "meeting_booked" : "stopped",
          { outcome },
        );
        updated++;
        break;
      }
      case "skip_step": {
        if (!["active", "paused", "pending"].includes(e.status)) continue;
        const steps = await stepsOf(e.campaign_id);
        const { data: touches } = await db.from("prospecting_touches").select("id, step_id, status").eq("enrollment_id", e.id);
        const byStep = new Map(((touches ?? []) as { id: string; step_id: string; status: string }[]).map((t) => [t.step_id, t]));
        const next = steps.find((s) => !EXECUTED.has(byStep.get(s.id)?.status ?? ""));
        if (!next) continue;
        const t = byStep.get(next.id);
        if (t) {
          await db.from("prospecting_touches").update({ status: "skipped", task_note: "Skipped manually", updated_at: now }).eq("id", t.id);
        } else {
          await db.from("prospecting_touches").insert({
            enrollment_id: e.id,
            step_id: next.id,
            campaign_id: e.campaign_id,
            user_id: e.user_id,
            kind: next.kind,
            position: next.position,
            status: "skipped",
            task_note: "Skipped manually",
          });
        }
        if (e.status === "active") await db.from("prospecting_enrollments").update({ next_run_at: now, updated_at: now }).eq("id", e.id);
        await logEvent({ type: "task_skipped", userId, campaignId: e.campaign_id, enrollmentId: e.id, contactId: e.contact_id, stepPosition: next.position });
        updated++;
        break;
      }
    }
  }

  for (const [campaignId, approvedIds] of Array.from(approvedPerCampaign.entries())) {
    const c = await campaignOf(campaignId);
    if (c?.status === "active") await activateEnrollments(c, approvedIds);
  }

  return { updated, errors: Array.from(new Set(errors)) };
}
