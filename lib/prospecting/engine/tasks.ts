// Tâches manuelles (LinkedIn, appels, tâches libres) : liste par échéance et
// actions du rep (fait, sauté, reporté). La complétion relance la séquence si
// l'étape attendait ("Wait until done") ou si la tâche est faite en avance.
import { db } from "@/lib/db";
import { localDayStartUtc } from "../schedule";
import { DEFAULT_TIMEZONE } from "../settings";
import { getCampaign, listSteps } from "../store/campaigns";
import { logEvent } from "../store/events";
import { getMailbox } from "../store/mailbox";
import { chunk, nowIso } from "../store/util";
import type {
  EnrollmentRow,
  StepKind,
  StepRow,
  TaskBucket,
  TaskKindFilter,
  TaskListItem,
  TaskOutcome,
  TasksResponse,
  TouchRow,
} from "../types";
import { advanceAfterExecution, setContactStatus, stopSequence } from "./advance";
import { pickNextStep } from "./next-step";

export class TaskError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export const TASK_OUTCOMES: TaskOutcome[] = ["done", "connected", "no_answer", "voicemail", "replied", "meeting_booked"];
export const TASK_BUCKETS: TaskBucket[] = ["overdue", "today", "upcoming", "done"];

const KIND_FILTERS: Record<TaskKindFilter, StepKind[]> = {
  linkedin: ["linkedin_visit", "linkedin_invite", "linkedin_message"],
  call: ["call"],
  other: ["task"],
};
const MANUAL_KINDS: StepKind[] = ["linkedin_visit", "linkedin_invite", "linkedin_message", "call", "task"];
const VISIBLE_ENROLLMENT_STATUSES = new Set(["active", "paused", "completed"]);
const CONTACT_COLUMNS = "id, first_name, last_name, title, company_name, email, phone, linkedin_url, hubspot_contact_id";

export interface TaskListFilters {
  buckets: TaskBucket[];
  kind: TaskKindFilter | null;
  campaignId: string | null;
}

function effectiveDue(t: TouchRow): string | null {
  const due = t.due_at;
  const snooze = t.snoozed_until;
  if (snooze && (!due || snooze > due)) return snooze;
  return due;
}

export async function listTasks(userId: string, filters: TaskListFilters): Promise<TasksResponse> {
  const tz = (await getMailbox(userId))?.timezone ?? DEFAULT_TIMEZONE;
  const now = new Date();
  const dayStart = localDayStartUtc(now, tz);
  const dayEnd = localDayStartUtc(new Date(dayStart.getTime() + 36 * 3600_000), tz);
  const kinds = filters.kind ? KIND_FILTERS[filters.kind] : MANUAL_KINDS;

  // 1. Tâches dues (avec report) et faites aujourd'hui.
  let dueQ = db.from("prospecting_touches").select("*").eq("user_id", userId).eq("status", "due").in("kind", kinds).order("due_at").limit(500);
  let doneQ = db
    .from("prospecting_touches")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["done", "skipped"])
    .in("kind", kinds)
    .gte("completed_at", dayStart.toISOString())
    .order("completed_at", { ascending: false })
    .limit(200);
  if (filters.campaignId) {
    dueQ = dueQ.eq("campaign_id", filters.campaignId);
    doneQ = doneQ.eq("campaign_id", filters.campaignId);
  }
  const [dueRes, doneRes] = await Promise.all([dueQ, doneQ]);
  if (dueRes.error) throw new Error(dueRes.error.message);
  if (doneRes.error) throw new Error(doneRes.error.message);
  const due = (dueRes.data ?? []) as TouchRow[];
  const done = (doneRes.data ?? []) as TouchRow[];

  // 2. À venir : étapes manuelles qui sont la prochaine étape d'une séquence active.
  let enrQ = db.from("prospecting_enrollments").select("*").eq("user_id", userId).eq("status", "active").limit(1000);
  if (filters.campaignId) enrQ = enrQ.eq("campaign_id", filters.campaignId);
  const { data: enrRows, error: enrErr } = await enrQ;
  if (enrErr) throw new Error(enrErr.message);
  const activeEnr = (enrRows ?? []) as EnrollmentRow[];
  const stepsByCampaign = new Map<string, StepRow[]>();
  const campaignIds = new Set<string>([...activeEnr.map((e) => e.campaign_id), ...due.map((t) => t.campaign_id), ...done.map((t) => t.campaign_id)]);
  for (const part of chunk(Array.from(campaignIds), 100)) {
    const { data } = await db.from("prospecting_steps").select("*").in("campaign_id", part).order("position");
    for (const s of (data ?? []) as StepRow[]) {
      const list = stepsByCampaign.get(s.campaign_id) ?? [];
      list.push(s);
      stepsByCampaign.set(s.campaign_id, list);
    }
  }
  const touchStates = new Map<string, Pick<TouchRow, "id" | "enrollment_id" | "step_id" | "status">[]>();
  for (const part of chunk(activeEnr.map((e) => e.id), 100)) {
    const { data } = await db.from("prospecting_touches").select("id, enrollment_id, step_id, status").in("enrollment_id", part);
    for (const t of (data ?? []) as Pick<TouchRow, "id" | "enrollment_id" | "step_id" | "status">[]) {
      const list = touchStates.get(t.enrollment_id) ?? [];
      list.push(t);
      touchStates.set(t.enrollment_id, list);
    }
  }
  const upcomingIds: string[] = [];
  const estimated = new Map<string, string | null>();
  for (const e of activeEnr) {
    const next = pickNextStep(stepsByCampaign.get(e.campaign_id) ?? [], touchStates.get(e.id) ?? []);
    if (!next || next.step.kind === "email" || !kinds.includes(next.step.kind) || !next.touch) continue;
    if (next.touch.status !== "draft" && next.touch.status !== "approved") continue;
    upcomingIds.push(next.touch.id);
    estimated.set(next.touch.id, e.next_run_at);
  }
  const upcoming: TouchRow[] = [];
  for (const part of chunk(upcomingIds, 200)) {
    const { data } = await db.from("prospecting_touches").select("*").in("id", part);
    upcoming.push(...((data ?? []) as TouchRow[]));
  }

  // 3. Contexte (contacts, campagnes, enrollments).
  const all = [...due, ...done, ...upcoming];
  const enrIds = Array.from(new Set(all.map((t) => t.enrollment_id)));
  const enrollments = new Map<string, EnrollmentRow>(activeEnr.map((e) => [e.id, e]));
  const missingEnr = enrIds.filter((id) => !enrollments.has(id));
  for (const part of chunk(missingEnr, 200)) {
    const { data } = await db.from("prospecting_enrollments").select("*").in("id", part);
    for (const e of (data ?? []) as EnrollmentRow[]) enrollments.set(e.id, e);
  }
  const contactIds = Array.from(new Set(Array.from(enrollments.values()).filter((e) => enrIds.includes(e.id)).map((e) => e.contact_id)));
  const contacts = new Map<string, TaskListItem["contact"]>();
  for (const part of chunk(contactIds, 200)) {
    const { data } = await db.from("prospecting_contacts").select(CONTACT_COLUMNS).in("id", part);
    for (const c of (data ?? []) as TaskListItem["contact"][]) contacts.set(c.id, c);
  }
  const campaigns = new Map<string, { id: string; name: string }>();
  for (const part of chunk(Array.from(campaignIds), 200)) {
    const { data } = await db.from("prospecting_campaigns").select("id, name").in("id", part);
    for (const c of (data ?? []) as { id: string; name: string }[]) campaigns.set(c.id, c);
  }

  const toItem = (t: TouchRow, bucket: TaskBucket, estimatedAt: string | null): TaskListItem | null => {
    const e = enrollments.get(t.enrollment_id);
    const contact = e ? contacts.get(e.contact_id) : undefined;
    const campaign = campaigns.get(t.campaign_id);
    if (!e || !contact || !campaign) return null;
    const steps = stepsByCampaign.get(t.campaign_id) ?? [];
    const step = steps.find((s) => s.id === t.step_id);
    return {
      touch: t,
      contact,
      campaign,
      enrollmentStatus: e.status,
      bucket,
      estimatedAt,
      stepPosition: step?.position ?? t.position,
      stepCount: steps.length,
      waitForCompletion: !!(step?.config as { waitForCompletion?: boolean } | undefined)?.waitForCompletion,
    };
  };

  const items: TaskListItem[] = [];
  const counts = { overdue: 0, today: 0, upcoming: 0, doneToday: 0 };
  const startIso = dayStart.toISOString();
  const endIso = dayEnd.toISOString();
  for (const t of due) {
    const e = enrollments.get(t.enrollment_id);
    if (!e || !VISIBLE_ENROLLMENT_STATUSES.has(e.status)) continue;
    const eff = effectiveDue(t);
    const bucket: TaskBucket = eff && eff >= endIso ? "upcoming" : eff && eff < startIso ? "overdue" : "today";
    const item = toItem(t, bucket, eff);
    if (!item) continue;
    counts[bucket === "upcoming" ? "upcoming" : bucket === "overdue" ? "overdue" : "today"]++;
    if (filters.buckets.includes(bucket)) items.push(item);
  }
  for (const t of upcoming) {
    const item = toItem(t, "upcoming", estimated.get(t.id) ?? null);
    if (!item) continue;
    counts.upcoming++;
    if (filters.buckets.includes("upcoming")) items.push(item);
  }
  for (const t of done) {
    const item = toItem(t, "done", t.completed_at);
    if (!item) continue;
    counts.doneToday++;
    if (filters.buckets.includes("done")) items.push(item);
  }

  const order: Record<TaskBucket, number> = { overdue: 0, today: 1, upcoming: 2, done: 3 };
  items.sort((a, b) => {
    if (a.bucket !== b.bucket) return order[a.bucket] - order[b.bucket];
    if (a.bucket === "done") return (b.estimatedAt ?? "").localeCompare(a.estimatedAt ?? "");
    const ax = a.estimatedAt ?? "9999";
    const bx = b.estimatedAt ?? "9999";
    return ax.localeCompare(bx);
  });
  return { items, counts };
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadOwnedTask(userId: string, touchId: string): Promise<TouchRow> {
  const { data } = await db.from("prospecting_touches").select("*").eq("id", touchId).eq("user_id", userId).maybeSingle();
  const touch = data as TouchRow | null;
  if (!touch || touch.kind === "email") throw new TaskError("Task not found", 404);
  return touch;
}

/**
 * Après la clôture d'une tâche : si l'étape bloquait la séquence ("Wait until
 * done") ou si la tâche est faite avant son échéance, on replanifie la suite.
 */
async function resumeAfterTask(touch: TouchRow, wasDue: boolean): Promise<void> {
  const { data } = await db.from("prospecting_enrollments").select("*").eq("id", touch.enrollment_id).maybeSingle();
  const enrollment = data as EnrollmentRow | null;
  if (!enrollment || enrollment.status !== "active") return;
  const campaign = await getCampaign(enrollment.campaign_id);
  if (!campaign) return;
  const steps = await listSteps(campaign.id);
  const step = steps.find((s) => s.id === touch.step_id);
  const waiting = wasDue && !!step?.config.waitForCompletion && !enrollment.next_run_at;
  if (wasDue && !waiting) return;
  const { data: touchRows } = await db.from("prospecting_touches").select("step_id, status").eq("enrollment_id", enrollment.id);
  await advanceAfterExecution({
    enrollment,
    campaign,
    steps,
    touches: (touchRows ?? []) as { step_id: string; status: TouchRow["status"] }[],
    executedAt: new Date(),
    executedPosition: wasDue ? enrollment.current_position : touch.position,
  });
}

async function closeTask(
  userId: string,
  touchId: string,
  status: "done" | "skipped",
  patch: Record<string, unknown>,
): Promise<{ touch: TouchRow; wasDue: boolean }> {
  const touch = await loadOwnedTask(userId, touchId);
  if (!["due", "draft", "approved"].includes(touch.status)) throw new TaskError("This task is already closed.", 409);
  const wasDue = touch.status === "due";
  const now = nowIso();
  const { data, error } = await db
    .from("prospecting_touches")
    .update({ ...patch, status, completed_at: now, snoozed_until: null, updated_at: now })
    .eq("id", touch.id)
    .eq("status", touch.status)
    .select("*");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new TaskError("This task changed in the meantime. Refresh and try again.", 409);
  return { touch: data[0] as TouchRow, wasDue };
}

export async function completeTask(
  userId: string,
  touchId: string,
  input: { outcome?: TaskOutcome | null; note?: string | null },
): Promise<TouchRow> {
  const outcome: TaskOutcome = input.outcome && TASK_OUTCOMES.includes(input.outcome) ? input.outcome : "done";
  const note = (input.note ?? "").trim().slice(0, 2000) || null;
  const { touch, wasDue } = await closeTask(userId, touchId, "done", { task_outcome: outcome, task_note: note });
  const { data } = await db.from("prospecting_enrollments").select("id, campaign_id, contact_id, user_id").eq("id", touch.enrollment_id).maybeSingle();
  const enrollment = data as Pick<EnrollmentRow, "id" | "campaign_id" | "contact_id" | "user_id"> | null;
  await logEvent({
    type: "task_done",
    userId,
    campaignId: touch.campaign_id,
    enrollmentId: touch.enrollment_id,
    contactId: enrollment?.contact_id ?? null,
    touchId: touch.id,
    stepPosition: touch.position,
    data: { kind: touch.kind, outcome, note },
  });

  if (enrollment && (outcome === "replied" || outcome === "meeting_booked")) {
    const now = nowIso();
    await stopSequence({
      enrollment,
      status: "replied",
      fromStatuses: ["active", "paused", "completed"],
      outcome: outcome === "meeting_booked" ? "meeting_booked" : null,
      repliedAt: now,
      eventType: outcome === "meeting_booked" ? "meeting_booked" : "replied",
      eventData: { via: touch.kind, touchId: touch.id },
      cancelReason: outcome === "meeting_booked" ? "Meeting booked" : "Prospect replied",
    });
    if (outcome === "meeting_booked") {
      // Arrêt déjà fait par une réponse : on enregistre quand même le meeting.
      await db.from("prospecting_enrollments").update({ outcome: "meeting_booked", updated_at: now }).eq("id", enrollment.id);
      await setContactStatus(enrollment.contact_id, "meeting", ["new", "in_sequence", "replied", "interested"]);
    } else {
      await setContactStatus(enrollment.contact_id, "replied", ["new", "in_sequence"]);
    }
    return touch;
  }
  await resumeAfterTask(touch, wasDue);
  return touch;
}

export async function skipTask(userId: string, touchId: string, note?: string | null): Promise<TouchRow> {
  const clean = (note ?? "").trim().slice(0, 2000) || null;
  const { touch, wasDue } = await closeTask(userId, touchId, "skipped", { task_outcome: "skipped", task_note: clean });
  await logEvent({
    type: "task_skipped",
    userId,
    campaignId: touch.campaign_id,
    enrollmentId: touch.enrollment_id,
    touchId: touch.id,
    stepPosition: touch.position,
    data: { kind: touch.kind, note: clean },
  });
  await resumeAfterTask(touch, wasDue);
  return touch;
}

export async function snoozeTask(userId: string, touchId: string, untilRaw: string): Promise<TouchRow> {
  const until = new Date(untilRaw);
  if (Number.isNaN(until.getTime())) throw new TaskError("Invalid snooze date.", 400);
  if (until.getTime() <= Date.now()) throw new TaskError("Snooze date must be in the future.", 400);
  if (until.getTime() > Date.now() + 60 * 86_400_000) throw new TaskError("Snooze is limited to 60 days.", 400);
  const touch = await loadOwnedTask(userId, touchId);
  if (touch.status !== "due") throw new TaskError("Only open tasks can be snoozed.", 409);
  const { data, error } = await db
    .from("prospecting_touches")
    .update({ snoozed_until: until.toISOString(), updated_at: nowIso() })
    .eq("id", touch.id)
    .eq("status", "due")
    .select("*");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new TaskError("This task changed in the meantime. Refresh and try again.", 409);
  await logEvent({
    type: "task_snoozed",
    userId,
    campaignId: touch.campaign_id,
    enrollmentId: touch.enrollment_id,
    touchId: touch.id,
    stepPosition: touch.position,
    data: { until: until.toISOString() },
  });
  return data[0] as TouchRow;
}
