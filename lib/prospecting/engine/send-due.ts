// Exécution des étapes dues d'une boîte : emails (avec pacing et caps) et
// tâches manuelles (LinkedIn, appels). Appelé par le tick APRÈS la synchro des
// réponses, sous le lease de la boîte.
//
// Ordre : relances d'abord (prospects déjà démarrés), puis next_run_at
// croissant. Filtres : fenêtre et startDate de la campagne, cap de la boîte
// (budget par tick), cap emails/jour de la campagne, nouveaux prospects/jour,
// un premier contact par entreprise et par jour. Une tâche manuelle ne consomme
// pas le budget email.
import { db } from "@/lib/db";
import { GmailAuthError } from "@/lib/gmail";
import { isInWindow, localDay, localDayKey, localDayStartUtc, ticksLeftToday } from "../schedule";
import { isManualKind } from "../settings";
import { displayName } from "../store/contacts";
import { listSteps, normalizeCampaign } from "../store/campaigns";
import { logEvent } from "../store/events";
import { isAllowedRecipient } from "../store/mailbox";
import { businessDomain, chunk, errMessage, nowIso } from "../store/util";
import type { CampaignRow, ContactRow, EnrollmentRow, MailboxRow, StepRow, TouchRow, TouchStatus } from "../types";
import { advanceAfterExecution, completeEnrollment, postponeEnrollment } from "./advance";
import type { SignatureData } from "./compose";
import { emptySendDueResult, sleep, timeLeft, type EngineContext, type PlannedAction, type SendDueResult } from "./context";
import { markMailboxDisconnected, resolveFromEmail } from "./mailbox-state";
import { pickNextStep } from "./next-step";
import { mailboxCapLeft, pauseBetweenSendsMs, tickBudget } from "./pacing";
import { sendEmailTouch } from "./send";

const MAX_CANDIDATES = 150;
const MIN_TIME_LEFT_MS = 30_000;
const PLAN_LIMIT = 200;

interface CampaignDay {
  emailsToday: number;
  startedToday: number;
  domainsToday: Set<string>;
}

function startDateReached(campaign: CampaignRow, now: Date): boolean {
  const start = campaign.settings.startDate;
  if (!start) return true;
  return localDayKey(localDay(now, campaign.settings.window.timezone)) >= start;
}

async function loadCampaignDay(campaign: CampaignRow, now: Date): Promise<CampaignDay> {
  const dayStart = localDayStartUtc(now, campaign.settings.window.timezone).toISOString();
  const [{ count: emailsToday }, { data: started }] = await Promise.all([
    db
      .from("prospecting_touches")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("kind", "email")
      .eq("status", "sent")
      .gte("sent_at", dayStart),
    db.from("prospecting_enrollments").select("contact_id").eq("campaign_id", campaign.id).gte("started_at", dayStart).limit(1000),
  ]);
  const contactIds = ((started ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
  const domains = new Set<string>();
  for (const part of chunk(contactIds, 200)) {
    const { data } = await db.from("prospecting_contacts").select("company_domain, email").in("id", part);
    for (const c of (data ?? []) as { company_domain: string | null; email: string | null }[]) {
      const d = businessDomain(c.company_domain, c.email);
      if (d) domains.add(d);
    }
  }
  return { emailsToday: emailsToday ?? 0, startedToday: contactIds.length, domainsToday: domains };
}

export async function sendDue(mailbox: MailboxRow, ctx: EngineContext): Promise<SendDueResult> {
  const res = emptySendDueResult();
  if (mailbox.status !== "active") {
    res.stoppedReason = `mailbox_${mailbox.status}`;
    return res;
  }
  const now = new Date();
  const nowStr = now.toISOString();
  const userId = mailbox.user_id;

  const { data: campRows, error: campErr } = await db.from("prospecting_campaigns").select("*").eq("user_id", userId).eq("status", "active");
  if (campErr) {
    res.errors.push(`campaigns: ${campErr.message}`);
    return res;
  }
  const open = new Map<string, CampaignRow>();
  for (const raw of (campRows ?? []) as Record<string, unknown>[]) {
    const c = normalizeCampaign(raw);
    if (isInWindow(now, c.settings.window) && startDateReached(c, now)) open.set(c.id, c);
  }
  if (open.size === 0) {
    res.stoppedReason = (campRows ?? []).length ? "outside_window" : "no_active_campaign";
    return res;
  }

  // Cap de la boîte (jour local du fuseau de la boîte) et budget de ce tick.
  const { count: sentTodayCount } = await db
    .from("prospecting_touches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "email")
    .eq("status", "sent")
    .gte("sent_at", localDayStartUtc(now, mailbox.timezone).toISOString());
  const capLeft = mailboxCapLeft(mailbox.daily_limit, sentTodayCount ?? 0);
  const ticksLeft = Math.max(...Array.from(open.values()).map((c) => ticksLeftToday(now, c.settings.window)));
  let emailBudget = ctx.sendMode === "off" ? 0 : tickBudget(capLeft, ticksLeft);
  res.capLeft = capLeft;
  res.budget = emailBudget;

  // Candidats.
  const { data: enrRows, error: enrErr } = await db
    .from("prospecting_enrollments")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("campaign_id", Array.from(open.keys()))
    .lte("next_run_at", nowStr)
    .or(`paused_until.is.null,paused_until.lte."${nowStr}"`)
    .order("next_run_at", { ascending: true })
    .limit(MAX_CANDIDATES);
  if (enrErr) {
    res.errors.push(`enrollments: ${enrErr.message}`);
    return res;
  }
  const candidates = ((enrRows ?? []) as EnrollmentRow[]).sort((a, b) => {
    const fa = a.started_at ? 0 : 1;
    const fb = b.started_at ? 0 : 1;
    return fa - fb || (a.next_run_at ?? "").localeCompare(b.next_run_at ?? "");
  });
  res.candidates = candidates.length;
  if (candidates.length === 0) return res;

  // Données associées, chargées en lot.
  const contacts = new Map<string, ContactRow>();
  for (const part of chunk(Array.from(new Set(candidates.map((e) => e.contact_id))), 200)) {
    const { data } = await db.from("prospecting_contacts").select("*").in("id", part);
    for (const c of (data ?? []) as ContactRow[]) contacts.set(c.id, c);
  }
  const stepsByCampaign = new Map<string, StepRow[]>();
  for (const id of new Set(candidates.map((e) => e.campaign_id))) stepsByCampaign.set(id, await listSteps(id));
  const touchesByEnr = new Map<string, TouchRow[]>();
  for (const part of chunk(candidates.map((e) => e.id), 100)) {
    const { data } = await db.from("prospecting_touches").select("*").in("enrollment_id", part);
    for (const t of (data ?? []) as TouchRow[]) {
      const list = touchesByEnr.get(t.enrollment_id) ?? [];
      list.push(t);
      touchesByEnr.set(t.enrollment_id, list);
    }
  }
  const days = new Map<string, CampaignDay>();
  for (const id of new Set(candidates.map((e) => e.campaign_id))) days.set(id, await loadCampaignDay(open.get(id) as CampaignRow, now));

  const { data: userRow } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  const senderName = mailbox.from_name || ((userRow as { name: string | null } | null)?.name ?? null);
  const signatureCache = new Map<string, SignatureData>();
  let fromEmail: string | null = null;
  let emailsStopped = emailBudget <= 0;
  let sentThisTick = 0;

  const plan = (p: PlannedAction) => {
    if (res.plan.length < PLAN_LIMIT) res.plan.push(p);
  };

  for (const enr of candidates) {
    if (timeLeft(ctx) < MIN_TIME_LEFT_MS) {
      res.stoppedReason = "time_budget";
      break;
    }
    const campaign = open.get(enr.campaign_id) as CampaignRow;
    const settings = campaign.settings;
    const steps = stepsByCampaign.get(enr.campaign_id) ?? [];
    const touches = touchesByEnr.get(enr.id) ?? [];
    const contact = contacts.get(enr.contact_id);
    const day = days.get(enr.campaign_id) as CampaignDay;
    if (!contact) continue;
    const who = displayName(contact);
    const base = { enrollmentId: enr.id, campaignId: enr.campaign_id, contact: who };

    const next = pickNextStep(steps, touches);
    if (!next) {
      plan({ ...base, position: null, kind: null, action: "complete" });
      if (!ctx.dryRun && (await completeEnrollment(enr))) res.completed++;
      continue;
    }
    const { step } = next;
    const touch = next.touch;
    const pBase = { ...base, position: step.position, kind: step.kind };
    if (touch?.status === "sending") continue; // envoi en cours ou à réconcilier

    // Premier contact : caps nouveaux prospects / jour et étalement par entreprise.
    const firstContact = !enr.started_at;
    const domain = businessDomain(contact.company_domain, contact.email);
    if (firstContact) {
      if (day.startedToday >= settings.newLeadsPerDay) {
        res.held++;
        plan({ ...pBase, action: "held", reason: "new_leads_per_day" });
        continue;
      }
      if (settings.sameCompanyStagger && domain && day.domainsToday.has(domain)) {
        res.held++;
        plan({ ...pBase, action: "held", reason: "same_company_today" });
        continue;
      }
    }

    // Étape email sans email : on la saute et on avance.
    if (step.kind === "email" && !contact.email) {
      plan({ ...pBase, action: "skip_no_email" });
      if (ctx.dryRun) continue;
      const ok = await skipTouch(enr, step, touch, "No email");
      if (ok) {
        res.skippedNoEmail++;
        const updated = upsertLocal(touches, touch, step, enr, "skipped");
        touchesByEnr.set(enr.id, updated);
        await advanceAfterExecution({ enrollment: enr, campaign, steps, touches: updated, executedAt: new Date(), executedPosition: step.position });
      }
      continue;
    }

    // Contenu manquant ou obsolète : bloqué jusqu'à (re)génération (visible dans Review).
    const visitWithoutTouch = !touch && step.kind === "linkedin_visit";
    const outdated = !!touch && touch.generated_step_version !== null && touch.generated_step_version < step.version && !touch.edited_by_user;
    if ((!touch && !visitWithoutTouch) || outdated) {
      res.held++;
      plan({ ...pBase, action: "outdated", reason: touch ? "step_changed" : "not_generated" });
      if (ctx.dryRun) continue;
      if (enr.content_status !== "outdated") {
        await db.from("prospecting_enrollments").update({ content_status: "outdated", updated_at: nowIso() }).eq("id", enr.id);
      }
      await postponeEnrollment(enr.id, 30);
      continue;
    }

    // ── Tâche manuelle ──
    if (isManualKind(step.kind)) {
      plan({ ...pBase, action: "create_task" });
      if (ctx.dryRun) {
        if (firstContact) bumpFirstContact(day, domain);
        continue;
      }
      const created = await createTask(enr, step, touch);
      if (!created) continue;
      res.tasksCreated++;
      if (firstContact) bumpFirstContact(day, domain);
      const updated = upsertLocal(touches, touch, step, enr, "due");
      touchesByEnr.set(enr.id, updated);
      await advanceAfterExecution({
        enrollment: enr,
        campaign,
        steps,
        touches: updated,
        executedAt: new Date(),
        executedPosition: step.position,
        waitForCompletion: step.config.waitForCompletion,
      });
      continue;
    }

    // ── Email ──
    if (!touch) continue;
    if (ctx.sendMode === "off") {
      res.held++;
      plan({ ...pBase, action: "held", reason: "send_mode_off" });
      continue;
    }
    if (emailsStopped || emailBudget <= 0) {
      res.held++;
      plan({ ...pBase, action: "held", reason: "tick_budget" });
      continue;
    }
    if (day.emailsToday >= settings.maxEmailsPerDay) {
      res.held++;
      plan({ ...pBase, action: "held", reason: "campaign_daily_cap" });
      continue;
    }
    if (settings.requireApproval && touch.status !== "approved") {
      res.held++;
      plan({ ...pBase, action: "held", reason: "awaiting_approval" });
      if (!ctx.dryRun) await postponeEnrollment(enr.id, 30);
      continue;
    }
    if (!isAllowedRecipient(contact.email as string)) {
      res.held++;
      plan({ ...pBase, action: "held", reason: "send_mode_allowlist" });
      if (!ctx.dryRun) await holdForAllowlist(enr, touch, step);
      continue;
    }

    plan({ ...pBase, action: "send_email" });
    if (ctx.dryRun) {
      emailBudget--;
      day.emailsToday++;
      if (firstContact) bumpFirstContact(day, domain);
      continue;
    }

    if (!fromEmail) {
      try {
        fromEmail = await resolveFromEmail(mailbox);
      } catch (e) {
        if (e instanceof GmailAuthError) await markMailboxDisconnected(mailbox, e.message);
        res.errors.push(`sender address: ${errMessage(e)}`);
        emailsStopped = true;
        continue;
      }
    }

    // Pause aléatoire entre deux envois de la même boîte (dans le budget de temps).
    if (sentThisTick > 0) {
      const pause = pauseBetweenSendsMs();
      if (timeLeft(ctx) < pause + MIN_TIME_LEFT_MS + 15_000) {
        emailsStopped = true;
        res.stoppedReason = "time_budget";
        continue;
      }
      await sleep(pause);
    }

    const out = await sendEmailTouch({
      mailbox,
      fromEmail,
      campaign,
      steps,
      step,
      enrollment: enr,
      contact,
      touch,
      senderName,
      signatureCache,
    });
    if (out.status === "sent") {
      res.sent++;
      sentThisTick++;
      emailBudget--;
      day.emailsToday++;
      if (firstContact) bumpFirstContact(day, domain);
    } else if (out.status === "blocked") {
      res.blocked++;
      if (out.stopMailbox) emailsStopped = true;
    } else if (out.status === "failed") {
      res.failed++;
      res.errors.push(`${who}: ${out.kind}: ${out.message}`.slice(0, 300));
      if (out.stopMailbox) {
        emailsStopped = true;
        res.stoppedReason = `gmail_${out.kind}`;
      }
    }
  }
  return res;
}

function bumpFirstContact(day: CampaignDay, domain: string | null) {
  day.startedToday++;
  if (domain) day.domainsToday.add(domain);
}

/** Copie locale des touches avec le nouveau statut de l'étape exécutée. */
function upsertLocal(touches: TouchRow[], touch: TouchRow | null, step: StepRow, enr: EnrollmentRow, status: TouchStatus): TouchRow[] {
  if (touch) return touches.map((t) => (t.id === touch.id ? { ...t, status } : t));
  const stub = {
    id: `local-${step.id}`,
    enrollment_id: enr.id,
    step_id: step.id,
    campaign_id: enr.campaign_id,
    user_id: enr.user_id,
    kind: step.kind,
    position: step.position,
    status,
  } as TouchRow;
  return [...touches, stub];
}

/** Étape email sans adresse : touche `skipped` (créée si la génération l'a omise). */
async function skipTouch(enr: EnrollmentRow, step: StepRow, touch: TouchRow | null, note: string): Promise<boolean> {
  const now = nowIso();
  if (touch) {
    const { data } = await db
      .from("prospecting_touches")
      .update({ status: "skipped", task_note: note, completed_at: now, updated_at: now })
      .eq("id", touch.id)
      .in("status", ["draft", "approved"])
      .select("id");
    if (!data?.length) return false;
  } else {
    const { data } = await db
      .from("prospecting_touches")
      .upsert(
        {
          enrollment_id: enr.id,
          step_id: step.id,
          campaign_id: enr.campaign_id,
          user_id: enr.user_id,
          kind: step.kind,
          position: step.position,
          status: "skipped",
          task_note: note,
          completed_at: now,
        },
        { onConflict: "enrollment_id,step_id", ignoreDuplicates: true },
      )
      .select("id");
    if (!data?.length) return false;
  }
  await logEvent({
    type: "skipped",
    userId: enr.user_id,
    campaignId: enr.campaign_id,
    enrollmentId: enr.id,
    contactId: enr.contact_id,
    touchId: touch?.id ?? null,
    stepPosition: step.position,
    data: { reason: "no_email" },
  });
  return true;
}

/** Étape manuelle due : la touche devient une tâche (créée pour une visite de profil sans contenu). */
async function createTask(enr: EnrollmentRow, step: StepRow, touch: TouchRow | null): Promise<boolean> {
  const now = nowIso();
  let touchId: string | null = touch?.id ?? null;
  if (touch) {
    const { data } = await db
      .from("prospecting_touches")
      .update({ status: "due", due_at: now, snoozed_until: null, updated_at: now })
      .eq("id", touch.id)
      .in("status", ["draft", "approved"])
      .select("id");
    if (!data?.length) return false;
  } else {
    const { data } = await db
      .from("prospecting_touches")
      .upsert(
        {
          enrollment_id: enr.id,
          step_id: step.id,
          campaign_id: enr.campaign_id,
          user_id: enr.user_id,
          kind: step.kind,
          position: step.position,
          status: "due",
          due_at: now,
        },
        { onConflict: "enrollment_id,step_id", ignoreDuplicates: true },
      )
      .select("id");
    if (!data?.length) return false;
    touchId = (data[0] as { id: string }).id;
  }
  await logEvent({
    type: "task_due",
    userId: enr.user_id,
    campaignId: enr.campaign_id,
    enrollmentId: enr.id,
    contactId: enr.contact_id,
    touchId,
    stepPosition: step.position,
    data: { kind: step.kind, waitForCompletion: step.config.waitForCompletion },
  });
  return true;
}

/** Mode allowlist : destinataire non autorisé, on retient (journalisé une seule fois). */
async function holdForAllowlist(enr: EnrollmentRow, touch: TouchRow, step: StepRow): Promise<void> {
  const reason = "Blocked by send mode (recipient not in the allowlist)";
  if (touch.last_error !== reason) {
    await db.from("prospecting_touches").update({ last_error: reason, updated_at: nowIso() }).eq("id", touch.id);
    await logEvent({
      type: "blocked",
      userId: enr.user_id,
      campaignId: enr.campaign_id,
      enrollmentId: enr.id,
      contactId: enr.contact_id,
      touchId: touch.id,
      stepPosition: step.position,
      data: { reason: "send_mode" },
    });
  }
  await postponeEnrollment(enr.id, 60);
}
