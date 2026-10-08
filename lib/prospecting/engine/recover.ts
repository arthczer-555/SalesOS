// Réconciliation des états interrompus :
// - touches restées en `sending` > 15 min (process tué entre l'envoi Gmail et
//   l'update final, ou timeout réseau à l'issue inconnue) : on cherche le
//   message dans le dossier Envoyés. Trouvé = on finalise sans renvoyer ;
//   absent = la touche redevient `approved` (nouvelle tentative au prochain
//   tick). JAMAIS de renvoi aveugle.
// - jobs background `running` sans progrès depuis > 20 min : re-dispatch une
//   fois, puis erreur "Interrupted, you can resume".
import { db } from "@/lib/db";
import { getMessageHeaders, listGmailMessageIds } from "@/lib/gmail";
import { getCampaign, listSteps } from "../store/campaigns";
import { dispatchJob } from "../store/jobs";
import { logEvent } from "../store/events";
import { errMessage, nowIso } from "../store/util";
import type { ContactRow, EnrollmentRow, JobRow, MailboxRow, TouchRow } from "../types";
import { renderTemplate } from "../variables";
import { sentEmailChain } from "./compose";
import type { EngineContext } from "./context";
import { MAX_SEND_ATTEMPTS } from "./pacing";
import { finalizeSentTouch } from "./send";
import { canonicalMessageId, normalizeSubject } from "./thread";

const STUCK_SENDING_MS = 15 * 60_000;
const STUCK_JOB_MS = 20 * 60_000;

export interface RecoverResult {
  recovered: number;
  released: number;
  errors: string[];
}

export async function recoverStuckTouches(mailbox: MailboxRow, ctx: EngineContext): Promise<RecoverResult> {
  const out: RecoverResult = { recovered: 0, released: 0, errors: [] };
  if (ctx.dryRun) return out;
  const cutoff = new Date(Date.now() - STUCK_SENDING_MS).toISOString();
  const { data, error } = await db
    .from("prospecting_touches")
    .select("*")
    .eq("user_id", mailbox.user_id)
    .eq("status", "sending")
    .lt("claimed_at", cutoff)
    .order("claimed_at", { ascending: true })
    .limit(20);
  if (error) {
    out.errors.push(`stuck touches: ${error.message}`);
    return out;
  }
  for (const touch of (data ?? []) as TouchRow[]) {
    try {
      const r = await reconcileTouch(mailbox, touch);
      if (r === "recovered") out.recovered++;
      else if (r === "released") out.released++;
    } catch (e) {
      // Recherche Gmail impossible (auth, réseau) : la touche reste `sending`,
      // on réessaiera au prochain tick. Surtout pas de renvoi.
      out.errors.push(`reconcile ${touch.id}: ${errMessage(e)}`);
    }
  }
  await backfillRfcIds(mailbox);
  return out;
}

/**
 * Message-ID RFC manquant sur des touches envoyées (lecture Gmail échouée juste
 * après l'envoi) : nécessaire au threading des relances et des réponses Inbox.
 */
async function backfillRfcIds(mailbox: MailboxRow): Promise<void> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db
    .from("prospecting_touches")
    .select("id, gmail_message_id")
    .eq("user_id", mailbox.user_id)
    .eq("status", "sent")
    .is("rfc_message_id", null)
    .not("gmail_message_id", "is", null)
    .gte("sent_at", since)
    .limit(10);
  for (const t of (data ?? []) as { id: string; gmail_message_id: string }[]) {
    try {
      const meta = await getMessageHeaders(mailbox.user_id, t.gmail_message_id, ["Message-ID"], mailbox.provider);
      const rfc = canonicalMessageId(meta.headers["message-id"]);
      if (rfc) await db.from("prospecting_touches").update({ rfc_message_id: rfc, updated_at: nowIso() }).eq("id", t.id);
    } catch {
      return; // Gmail indisponible : prochain tick.
    }
  }
}

async function reconcileTouch(mailbox: MailboxRow, touch: TouchRow): Promise<"recovered" | "released" | "skipped"> {
  const { data: enrRow } = await db.from("prospecting_enrollments").select("*").eq("id", touch.enrollment_id).maybeSingle();
  const enrollment = enrRow as EnrollmentRow | null;
  if (!enrollment) return "skipped";
  const { data: contactRow } = await db.from("prospecting_contacts").select("*").eq("id", enrollment.contact_id).maybeSingle();
  const contact = contactRow as ContactRow | null;
  const { data: touchRows } = await db.from("prospecting_touches").select("*").eq("enrollment_id", enrollment.id);
  const touches = (touchRows ?? []) as TouchRow[];

  if (contact?.email && touch.claimed_at) {
    const after = Math.floor(new Date(touch.claimed_at).getTime() / 1000) - 60;
    const ids = await listGmailMessageIds(mailbox.user_id, `in:sent to:${contact.email} after:${after}`, 10, mailbox.provider);
    if (ids.length) {
      // Sujets attendus : celui de la touche (rendu) et le sujet racine du thread.
      const chain = sentEmailChain(touches.filter((t) => t.id !== touch.id));
      const expected = new Set<string>();
      const rendered = renderTemplate(touch.subject ?? "", { contact, senderName: mailbox.from_name }).text;
      if (normalizeSubject(rendered)) expected.add(normalizeSubject(rendered));
      if (chain[0]?.subject) expected.add(normalizeSubject(chain[0].subject));
      for (const m of ids) {
        const meta = await getMessageHeaders(mailbox.user_id, m.id, ["Subject", "Message-ID", "To"], mailbox.provider);
        const subject = meta.headers["subject"] ?? "";
        if (expected.size && !expected.has(normalizeSubject(subject))) continue;
        const campaign = await getCampaign(touch.campaign_id);
        if (!campaign) return "skipped";
        const steps = await listSteps(campaign.id);
        const ok = await finalizeSentTouch({
          touch,
          claimId: null,
          mailbox,
          campaign,
          steps,
          enrollment,
          contact,
          touches,
          sent: {
            messageId: meta.id,
            threadId: meta.threadId,
            rfcMessageId: canonicalMessageId(meta.headers["message-id"]),
            sentAt: meta.internalDate ? new Date(Number(meta.internalDate)) : new Date(touch.claimed_at),
            subject: subject || touch.subject || "",
            body: null,
            fromEmail: mailbox.email_address ?? "",
          },
          recovered: true,
        });
        return ok ? "recovered" : "skipped";
      }
    }
  }

  // Pas trouvé dans les Envoyés : l'email n'est pas parti, nouvelle tentative.
  const attempts = touch.attempts + 1;
  const final = attempts >= MAX_SEND_ATTEMPTS;
  const { data: upd } = await db
    .from("prospecting_touches")
    .update({
      status: final ? "failed" : "approved",
      claim_id: null,
      claimed_at: null,
      attempts,
      last_error: final ? "Sending kept getting interrupted" : "Send was interrupted before reaching Gmail, retrying",
      updated_at: nowIso(),
    })
    .eq("id", touch.id)
    .eq("status", "sending")
    .select("id");
  if (!upd?.length) return "skipped";
  if (final) {
    await db
      .from("prospecting_enrollments")
      .update({ status: "error", error: "Sending kept getting interrupted", next_run_at: null, updated_at: nowIso() })
      .eq("id", enrollment.id)
      .eq("status", "active");
  }
  await logEvent({
    type: "send_failed",
    userId: enrollment.user_id,
    campaignId: enrollment.campaign_id,
    enrollmentId: enrollment.id,
    contactId: enrollment.contact_id,
    touchId: touch.id,
    stepPosition: touch.position,
    data: { kind: "interrupted", attempts, final },
  });
  return "released";
}

/** Jobs background bloqués : une relance, puis erreur explicite. */
export async function recoverStuckJobs(ctx: EngineContext, userId?: string): Promise<number> {
  if (ctx.dryRun) return 0;
  const cutoff = new Date(Date.now() - STUCK_JOB_MS).toISOString();
  let q = db.from("prospecting_jobs").select("*").eq("status", "running").lt("updated_at", cutoff).limit(20);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let handled = 0;
  for (const job of (data ?? []) as JobRow[]) {
    const markInterrupted = () =>
      db
        .from("prospecting_jobs")
        .update({ status: "error", error: "Interrupted, you can resume", finished_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id)
        .eq("status", "running");
    if (job.params?.retried) {
      await markInterrupted();
      handled++;
      continue;
    }
    const params = { ...(job.params ?? {}), retried: true };
    const { data: upd } = await db
      .from("prospecting_jobs")
      .update({ status: "queued", params, updated_at: nowIso() })
      .eq("id", job.id)
      .eq("status", "running")
      .select("*");
    if (!upd?.length) continue;
    try {
      await dispatchJob(upd[0] as JobRow, ctx.origin);
    } catch (e) {
      console.error("[prospecting] job re-dispatch failed:", errMessage(e));
      await db
        .from("prospecting_jobs")
        .update({ status: "error", error: "Interrupted, you can resume", finished_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id);
    }
    handled++;
  }
  return handled;
}
