// Tick du moteur Prospecting (toutes les 10 min, Background Function) :
// pour chaque boîte qui a de l'activité, sous un lease exclusif :
//   recoverStuck -> syncMailbox (TOUJOURS avant d'envoyer) -> sendDue -> release.
// Les réponses ne passent par aucune IA : arrêt de la séquence + DM Slack (sync.ts).
// Concurrence 4 boîtes, budget global 11 min (la Background Function en a 15).
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getOrCreateMailbox, getSendMode } from "../store/mailbox";
import { errMessage, mapLimit, nowIso } from "../store/util";
import type { MailboxRow, MailboxSyncResult } from "../types";
import {
  defaultOrigin,
  emptySyncSummary,
  timeLeft,
  type EngineContext,
  type MailboxTickResult,
  type TickSummary,
} from "./context";
import { resumeTimedPauses } from "./advance";
import { reloadMailbox } from "./mailbox-state";
import { recoverStuckJobs, recoverStuckTouches } from "./recover";
import { sendDue } from "./send-due";
import { syncMailbox } from "./sync";

export interface TickOptions {
  /** Budget de temps total (défaut 11 min). */
  deadlineMs?: number;
  /** Ne traite que la boîte de cet utilisateur. */
  userId?: string;
  /** Simulation : aucun envoi ni écriture, retourne le plan par boîte. */
  dryRun?: boolean;
  origin?: string;
}

const DEFAULT_BUDGET_MS = 11 * 60_000;
const MAILBOX_CONCURRENCY = 4;
const MIN_TIME_TO_START_MS = 60_000;

export async function runProspectingTick(opts: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now();
  const ctx: EngineContext = {
    deadline: started + (opts.deadlineMs ?? DEFAULT_BUDGET_MS),
    dryRun: !!opts.dryRun,
    sendMode: getSendMode(),
    origin: opts.origin ?? defaultOrigin(),
  };
  const summary: TickSummary = {
    ok: true,
    dryRun: ctx.dryRun,
    sendMode: ctx.sendMode,
    startedAt: new Date(started).toISOString(),
    finishedAt: "",
    durationMs: 0,
    mailboxes: 0,
    processed: 0,
    sent: 0,
    tasksCreated: 0,
    completed: 0,
    replies: 0,
    bounces: 0,
    jobsRecovered: 0,
    errors: [],
    results: [],
  };

  try {
    if (!ctx.dryRun) {
      await reactivateMailboxes(opts.userId);
      summary.jobsRecovered = await recoverStuckJobs(ctx, opts.userId).catch((e) => {
        summary.errors.push(`jobs: ${errMessage(e)}`);
        return 0;
      });
    }
    const mailboxes = await listMailboxesToProcess(opts.userId);
    summary.mailboxes = mailboxes.length;
    summary.results = await mapLimit(mailboxes, MAILBOX_CONCURRENCY, (m) => processMailbox(m, ctx));
  } catch (e) {
    summary.ok = false;
    summary.errors.push(errMessage(e));
  }

  for (const r of summary.results) {
    if (!r.skipped) summary.processed++;
    summary.sent += r.send?.sent ?? 0;
    summary.tasksCreated += r.send?.tasksCreated ?? 0;
    summary.completed += r.send?.completed ?? 0;
    summary.replies += (r.sync?.replies ?? 0) + (r.sync?.colleagueReplies ?? 0);
    summary.bounces += r.sync?.bounces ?? 0;
    for (const err of r.errors) summary.errors.push(`${r.email ?? r.userId}: ${err}`);
  }
  summary.finishedAt = nowIso();
  summary.durationMs = Date.now() - started;
  return summary;
}

/** Boîtes en pause temporaire (quota Gmail...) dont la pause est échue. */
async function reactivateMailboxes(userId?: string): Promise<void> {
  let q = db
    .from("prospecting_mailboxes")
    .update({ status: "active", paused_reason: null, paused_until: null, updated_at: nowIso() })
    .eq("status", "paused")
    .not("paused_until", "is", null)
    .lte("paused_until", nowIso());
  if (userId) q = q.eq("user_id", userId);
  const { error } = await q;
  if (error) console.error("[prospecting] mailbox reactivation failed:", error.message);
}

/**
 * Boîtes à traiter : connectées (actives, ou en pause manuelle : on continue
 * de détecter les réponses), avec une campagne active, une séquence vivante ou
 * un email envoyé dans les 30 derniers jours.
 */
async function listMailboxesToProcess(userId?: string): Promise<MailboxRow[]> {
  let q = db.from("prospecting_mailboxes").select("*").in("status", ["active", "paused"]);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error(`mailboxes: ${error.message}`);
  const rows = (data ?? []) as MailboxRow[];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const out: MailboxRow[] = [];
  for (const m of rows) {
    const [campaigns, live, sent] = await Promise.all([
      db.from("prospecting_campaigns").select("id", { count: "exact", head: true }).eq("user_id", m.user_id).eq("status", "active"),
      db.from("prospecting_enrollments").select("id", { count: "exact", head: true }).eq("user_id", m.user_id).in("status", ["active", "paused"]),
      db.from("prospecting_touches").select("id", { count: "exact", head: true }).eq("user_id", m.user_id).eq("status", "sent").gte("sent_at", since),
    ]);
    if ((campaigns.count ?? 0) > 0 || (live.count ?? 0) > 0 || (sent.count ?? 0) > 0) out.push(m);
  }
  return out;
}

/** Lease conditionnel : un seul tick (ou une synchro manuelle) par boîte à la fois. */
async function acquireLease(mailboxId: string, owner: string, ms: number): Promise<boolean> {
  const now = nowIso();
  const { data, error } = await db
    .from("prospecting_mailboxes")
    .update({ lease_until: new Date(Date.now() + ms).toISOString(), lease_owner: owner })
    .eq("id", mailboxId)
    .or(`lease_until.is.null,lease_until.lt."${now}"`)
    .select("id");
  return !error && !!data?.length;
}

async function releaseLease(mailboxId: string, owner: string): Promise<void> {
  await db.from("prospecting_mailboxes").update({ lease_until: null, lease_owner: null }).eq("id", mailboxId).eq("lease_owner", owner);
}

function emptyResult(m: MailboxRow): MailboxTickResult {
  return { userId: m.user_id, mailboxId: m.id, email: m.email_address, skipped: null, recovered: 0, sync: null, send: null, errors: [] };
}

async function processMailbox(mailbox: MailboxRow, ctx: EngineContext): Promise<MailboxTickResult> {
  const r = emptyResult(mailbox);
  if (timeLeft(ctx) < MIN_TIME_TO_START_MS) {
    r.skipped = "time_budget";
    return r;
  }
  if (ctx.dryRun) {
    // Simulation : lecture seule, pas de lease.
    try {
      r.send = await sendDue(mailbox, ctx);
    } catch (e) {
      r.errors.push(errMessage(e));
    }
    return r;
  }

  const owner = randomUUID();
  if (!(await acquireLease(mailbox.id, owner, timeLeft(ctx) + 60_000))) {
    r.skipped = "locked";
    return r;
  }
  try {
    const rec = await recoverStuckTouches(mailbox, ctx);
    r.recovered = rec.recovered;
    r.errors.push(...rec.errors);

    const fresh = (await reloadMailbox(mailbox.id)) ?? mailbox;
    r.sync = await syncMailbox(fresh, ctx);
    if (r.sync.error) r.errors.push(`sync: ${r.sync.error}`);

    // Pauses temporisées échues (absence) : la séquence reprend.
    await resumeTimedPauses(mailbox.user_id);

    // La synchro a pu déconnecter la boîte ou arrêter des séquences : relire.
    const afterSync = (await reloadMailbox(mailbox.id)) ?? fresh;
    if (timeLeft(ctx) > MIN_TIME_TO_START_MS / 2) {
      r.send = await sendDue(afterSync, ctx);
      r.errors.push(...r.send.errors);
    }
  } catch (e) {
    r.errors.push(errMessage(e));
  } finally {
    await releaseLease(mailbox.id, owner);
  }
  return r;
}

/**
 * "Check replies now" : synchro immédiate de la boîte d'un rep, sans envoi. Retourne null si un tick tient déjà la boîte.
 */
export async function syncMailboxNow(userId: string, budgetMs = 45_000): Promise<MailboxSyncResult | null> {
  const mailbox = await getOrCreateMailbox(userId);
  const ctx: EngineContext = {
    deadline: Date.now() + budgetMs,
    dryRun: false,
    sendMode: getSendMode(),
    origin: defaultOrigin(),
  };
  const owner = randomUUID();
  if (!(await acquireLease(mailbox.id, owner, budgetMs + 30_000))) return null;
  try {
    const sync = mailbox.status === "disconnected" ? { ...emptySyncSummary("skipped"), error: "Gmail is disconnected" } : await syncMailbox(mailbox, ctx);
    return { sync, newReplies: sync.replies + sync.colleagueReplies, syncedAt: nowIso() };
  } finally {
    await releaseLease(mailbox.id, owner);
  }
}
