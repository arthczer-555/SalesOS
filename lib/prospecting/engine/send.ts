// Envoi d'une touche email, sans JAMAIS double-envoyer :
// 1. claim conditionnel (approved[/draft] -> sending, claim_id unique) : un
//    seul tick peut gagner la touche ;
// 2. re-lecture fraîche AVANT Gmail (séquence active, pas de réponse, contact
//    non supprimé, boîte active, contenu final valide, mode d'envoi) ; en cas
//    d'échec la touche revient à son statut précédent ;
// 3. Gmail ; 4. update final conditionné au claim_id.
// Si le process meurt entre 3 et 4, la touche reste `sending` et recover.ts la
// réconcilie via une recherche Gmail `in:sent` (jamais de renvoi aveugle).
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { GmailSendError, getMessageHeaders, sendGmailRaw } from "@/lib/gmail";
import { ensureHubspotContactDetailed, logEmailToHubspotDetailed } from "../hubspot-log";
import { getCampaign } from "../store/campaigns";
import { logEvent } from "../store/events";
import { isAllowedRecipient } from "../store/mailbox";
import { isSuppressed, loadSuppressionSets } from "../store/suppressions";
import { errMessage, nowIso } from "../store/util";
import type { CampaignRow, ContactRow, EnrollmentRow, MailboxRow, StepRow, TouchRow, TouchStatus } from "../types";
import { advanceAfterExecution, postponeEnrollment, setContactStatus, stopSequence } from "./advance";
import { composeEmail, type BlockReason, type SignatureData } from "./compose";
import { markMailboxDisconnected, pauseMailboxForQuota } from "./mailbox-state";
import { MAX_SEND_ATTEMPTS, transientBackoffMs } from "./pacing";
import { canonicalMessageId } from "./thread";

export type SendOutcome =
  | { status: "sent"; messageId: string; threadId: string }
  | { status: "lost" }
  | { status: "blocked"; reason: BlockReason; detail: string; stopMailbox: boolean }
  | { status: "failed"; kind: string; message: string; stopMailbox: boolean };

export interface SendInput {
  mailbox: MailboxRow;
  fromEmail: string;
  campaign: CampaignRow;
  steps: StepRow[];
  step: StepRow;
  enrollment: EnrollmentRow;
  contact: ContactRow;
  /** Touche telle que lue au début du tick (statut avant claim). */
  touch: TouchRow;
  senderName: string | null;
  signatureCache?: Map<string, SignatureData>;
}

const BLOCKED_CONTACT_STATUSES = new Set(["do_not_contact", "unsubscribed", "bounced"]);

/** Raisons de blocage dues au contenu : on reporte et on ne journalise qu'une fois. */
const CONTENT_REASONS = new Set<BlockReason>(["empty_body", "missing_subject", "unresolved_variable", "lint_error", "outdated_content"]);

export async function sendEmailTouch(input: SendInput): Promise<SendOutcome> {
  const { mailbox, campaign, step, enrollment } = input;
  const prevStatus: TouchStatus = input.touch.status;
  const allowed: TouchStatus[] = campaign.settings.requireApproval ? ["approved"] : ["approved", "draft"];
  const claimId = randomUUID();
  const claimedAt = nowIso();

  const { data: claimedRows, error: claimErr } = await db
    .from("prospecting_touches")
    .update({ status: "sending", claim_id: claimId, claimed_at: claimedAt, updated_at: claimedAt })
    .eq("id", input.touch.id)
    .in("status", allowed)
    .select("*");
  if (claimErr || !claimedRows?.length) return { status: "lost" };
  const touch = claimedRows[0] as TouchRow;

  const release = async (detail: string) => {
    await db
      .from("prospecting_touches")
      .update({ status: prevStatus, claim_id: null, claimed_at: null, last_error: detail, updated_at: nowIso() })
      .eq("id", touch.id)
      .eq("claim_id", claimId);
  };

  const block = async (reason: BlockReason, detail: string, stopMailbox = false): Promise<SendOutcome> => {
    await release(detail);
    // Un blocage persistant (contenu, mode d'envoi) n'est journalisé qu'une fois.
    if (input.touch.last_error !== detail) {
      await logEvent({
        type: "blocked",
        userId: enrollment.user_id,
        campaignId: enrollment.campaign_id,
        enrollmentId: enrollment.id,
        contactId: enrollment.contact_id,
        touchId: touch.id,
        stepPosition: step.position,
        data: { reason, detail },
      });
    }
    if (CONTENT_REASONS.has(reason) || reason === "send_mode") await postponeEnrollment(enrollment.id, 60);
    return { status: "blocked", reason, detail, stopMailbox };
  };

  // ── Re-lecture fraîche ────────────────────────────────────────────────────
  const [enrRes, contactRes, mbRes, touchesRes, freshCampaign] = await Promise.all([
    db.from("prospecting_enrollments").select("*").eq("id", enrollment.id).maybeSingle(),
    db.from("prospecting_contacts").select("*").eq("id", enrollment.contact_id).maybeSingle(),
    db.from("prospecting_mailboxes").select("*").eq("id", mailbox.id).maybeSingle(),
    db.from("prospecting_touches").select("*").eq("enrollment_id", enrollment.id),
    getCampaign(campaign.id),
  ]);
  const freshEnr = enrRes.data as EnrollmentRow | null;
  const contact = contactRes.data as ContactRow | null;
  const freshMailbox = mbRes.data as MailboxRow | null;
  const touches = (touchesRes.data ?? []) as TouchRow[];
  const now = Date.now();

  if (!freshEnr || freshEnr.status !== "active" || freshEnr.replied_at || (freshEnr.paused_until && new Date(freshEnr.paused_until).getTime() > now)) {
    const ended = !freshEnr || freshEnr.replied_at || !["active", "paused"].includes(freshEnr.status);
    if (ended) {
      // Séquence terminée pendant le claim (réponse, stop) : l'étape est annulée, pas relâchée.
      await db
        .from("prospecting_touches")
        .update({ status: "canceled", claim_id: null, claimed_at: null, task_note: "Sequence ended", updated_at: nowIso() })
        .eq("id", touch.id)
        .eq("claim_id", claimId);
      return { status: "blocked", reason: "enrollment_inactive", detail: "Sequence ended", stopMailbox: false };
    }
    return block("enrollment_inactive", "Sequence is no longer active");
  }
  if (!freshCampaign || freshCampaign.status !== "active") return block("campaign_inactive", "Campaign is not active");
  if (!freshMailbox || freshMailbox.status !== "active") return block("mailbox_inactive", "Mailbox is paused or disconnected", true);
  if (freshMailbox.provider !== mailbox.provider) return block("mailbox_inactive", "Sending mailbox changed during this run", true);
  if (!contact || !contact.email) return block("no_email", "No email address");

  const suppressions = await loadSuppressionSets([contact.email], contact.company_domain ? [contact.company_domain] : []);
  if (
    isSuppressed(suppressions, contact.email, contact.company_domain) ||
    BLOCKED_CONTACT_STATUSES.has(contact.status) ||
    contact.email_status === "invalid" ||
    contact.email_status === "bounced"
  ) {
    await release("Contact is on the do-not-contact list");
    await stopSequence({
      enrollment,
      status: "stopped",
      stopReason: "suppressed",
      eventType: "stopped",
      eventData: { reason: "suppressed" },
      cancelReason: "Contact suppressed",
    });
    return { status: "blocked", reason: "suppressed", detail: "Contact is on the do-not-contact list", stopMailbox: false };
  }

  // Contenu obsolète (étape modifiée depuis la génération, non retouché à la main).
  if (touch.generated_step_version !== null && touch.generated_step_version < step.version && !touch.edited_by_user) {
    await db
      .from("prospecting_enrollments")
      .update({ content_status: "outdated", updated_at: nowIso() })
      .eq("id", enrollment.id)
      .neq("content_status", "outdated");
    return block("outdated_content", "Step changed since this message was written: regenerate or edit it");
  }

  let composed;
  try {
    composed = await composeEmail({
      mailbox: freshMailbox,
      fromEmail: input.fromEmail,
      campaign: freshCampaign,
      steps: input.steps,
      step,
      touch,
      touches,
      contact,
      senderName: input.senderName,
      signatureCache: input.signatureCache,
    });
  } catch (e) {
    await release(`Could not prepare the email: ${errMessage(e)}`);
    return { status: "failed", kind: "compose", message: errMessage(e), stopMailbox: false };
  }
  if (!composed.ok) return block(composed.reason, composed.detail);
  if (!isAllowedRecipient(composed.email.to)) return block("send_mode", "Blocked by send mode (recipient not in the allowlist)");

  // ── Envoi Gmail ───────────────────────────────────────────────────────────
  let sent: { id: string; threadId: string };
  try {
    sent = await sendGmailRaw(mailbox.user_id, { raw: composed.email.raw, threadId: composed.email.threadId }, freshMailbox.provider);
  } catch (e) {
    return handleSendError(e, { input, touch, claimId, prevStatus, contact });
  }

  // Message-ID réel (threading des relances). Null si échec : résolu plus tard.
  let rfc: string | null = null;
  try {
    const meta = await getMessageHeaders(mailbox.user_id, sent.id, ["Message-ID"], freshMailbox.provider);
    rfc = canonicalMessageId(meta.headers["message-id"]);
  } catch {
    rfc = null;
  }

  await finalizeSentTouch({
    touch,
    claimId,
    mailbox: freshMailbox,
    campaign: freshCampaign,
    steps: input.steps,
    enrollment: freshEnr,
    contact,
    touches,
    sent: {
      messageId: sent.id,
      threadId: sent.threadId,
      rfcMessageId: rfc,
      sentAt: new Date(),
      subject: composed.email.subject,
      body: composed.email.body,
      fromEmail: input.fromEmail,
    },
  });
  return { status: "sent", messageId: sent.id, threadId: sent.threadId };
}

// ── Erreurs Gmail ─────────────────────────────────────────────────────────────

async function handleSendError(
  e: unknown,
  ctx: { input: SendInput; touch: TouchRow; claimId: string; prevStatus: TouchStatus; contact: ContactRow },
): Promise<SendOutcome> {
  const { input, touch, claimId, prevStatus, contact } = ctx;
  const { mailbox, enrollment, step } = input;
  const err = e instanceof GmailSendError ? e : new GmailSendError(errMessage(e), "transient", 0);
  const message = err.message.slice(0, 500);
  const event = (data: Record<string, unknown>) =>
    logEvent({
      type: "send_failed",
      userId: enrollment.user_id,
      campaignId: enrollment.campaign_id,
      enrollmentId: enrollment.id,
      contactId: enrollment.contact_id,
      touchId: touch.id,
      stepPosition: step.position,
      data: { kind: err.kind, status: err.status, message, ...data },
    });
  const touchUpdate = (patch: Record<string, unknown>) =>
    db
      .from("prospecting_touches")
      .update({ ...patch, updated_at: nowIso() })
      .eq("id", touch.id)
      .eq("claim_id", claimId);

  if (err.kind === "auth") {
    await touchUpdate({ status: prevStatus, claim_id: null, claimed_at: null, last_error: "Gmail disconnected" });
    await markMailboxDisconnected(mailbox, message);
    await event({});
    return { status: "failed", kind: "auth", message, stopMailbox: true };
  }

  if (err.kind === "quota") {
    await touchUpdate({ status: prevStatus, claim_id: null, claimed_at: null, last_error: "Gmail sending limit reached" });
    const until = await pauseMailboxForQuota(mailbox, input.campaign.settings.window, message);
    await event({ pausedUntil: until });
    return { status: "failed", kind: "quota", message, stopMailbox: true };
  }

  if (err.kind === "invalid_recipient") {
    await touchUpdate({ status: "failed", claim_id: null, last_error: `Invalid recipient: ${message}`, attempts: touch.attempts + 1 });
    await db.from("prospecting_contacts").update({ email_status: "invalid", updated_at: nowIso() }).eq("id", contact.id);
    await db
      .from("prospecting_enrollments")
      .update({ status: "error", error: "Invalid email address", next_run_at: null, updated_at: nowIso() })
      .eq("id", enrollment.id)
      .eq("status", "active");
    await event({});
    return { status: "failed", kind: "invalid_recipient", message, stopMailbox: false };
  }

  // Transitoire. Sans réponse HTTP (status 0 : timeout, réseau), Gmail a pu
  // accepter le message : on laisse la touche en `sending` pour que recover.ts
  // vérifie le dossier Envoyés avant toute nouvelle tentative.
  const attempts = touch.attempts + 1;
  if (err.status === 0) {
    await touchUpdate({ last_error: `Send outcome unknown (${message}), checking Gmail before retrying` });
    await postponeEnrollment(enrollment.id, 20);
    await event({ outcome: "unknown" });
    return { status: "failed", kind: "unknown_outcome", message, stopMailbox: false };
  }
  if (attempts >= MAX_SEND_ATTEMPTS) {
    await touchUpdate({ status: "failed", claim_id: null, attempts, last_error: message });
    await db
      .from("prospecting_enrollments")
      .update({ status: "error", error: `Sending failed after ${attempts} attempts: ${message}`.slice(0, 500), next_run_at: null, updated_at: nowIso() })
      .eq("id", enrollment.id)
      .eq("status", "active");
    await event({ attempts, final: true });
    return { status: "failed", kind: "transient", message, stopMailbox: false };
  }
  await touchUpdate({ status: "approved", claim_id: null, claimed_at: null, attempts, last_error: message });
  await db
    .from("prospecting_enrollments")
    .update({ next_run_at: new Date(Date.now() + transientBackoffMs(attempts)).toISOString(), updated_at: nowIso() })
    .eq("id", enrollment.id)
    .eq("status", "active");
  await event({ attempts });
  return { status: "failed", kind: "transient", message, stopMailbox: false };
}

// ── Après envoi ───────────────────────────────────────────────────────────────

export interface FinalizeInput {
  touch: TouchRow;
  /** Claim de l'envoi ; null = réconciliation (condition sur status = sending). */
  claimId: string | null;
  mailbox: MailboxRow;
  campaign: CampaignRow;
  steps: StepRow[];
  enrollment: EnrollmentRow;
  contact: ContactRow;
  touches: TouchRow[];
  sent: {
    messageId: string;
    threadId: string;
    rfcMessageId: string | null;
    sentAt: Date;
    subject: string;
    body: string | null;
    fromEmail: string;
  };
  recovered?: boolean;
}

/**
 * Touche `sent` + outreach_log + événement + avancement de la séquence +
 * statut du contact + HubSpot (best-effort). Partagé avec la réconciliation.
 */
export async function finalizeSentTouch(input: FinalizeInput): Promise<boolean> {
  const { touch, mailbox, campaign, enrollment, contact, sent } = input;
  const sentAt = sent.sentAt.toISOString();
  const patch: Record<string, unknown> = {
    status: "sent",
    sent_at: sentAt,
    gmail_message_id: sent.messageId,
    gmail_thread_id: sent.threadId,
    rfc_message_id: sent.rfcMessageId,
    subject: sent.subject,
    claim_id: null,
    last_error: null,
    updated_at: nowIso(),
  };
  if (sent.body !== null) patch.body = sent.body;

  let updated = false;
  for (let attempt = 0; attempt < 2 && !updated; attempt++) {
    let q = db.from("prospecting_touches").update(patch).eq("id", touch.id);
    q = input.claimId ? q.eq("claim_id", input.claimId) : q.eq("status", "sending");
    const { data, error } = await q.select("id");
    if (!error) {
      updated = !!data?.length;
      break;
    }
  }
  if (!updated) {
    console.error(`[prospecting] touch ${touch.id} sent but final update failed: left to reconciliation`);
    return false;
  }

  // Journal d'envoi partagé (badges "X exchanges", historique watchlist).
  const { data: existingLog } = await db.from("outreach_log").select("id").eq("source", "prospecting").eq("source_id", touch.id).limit(1);
  if (!existingLog?.length) {
    const { error: logErr } = await db.from("outreach_log").insert({
      user_id: String(mailbox.user_id),
      email: contact.email,
      hubspot_id: contact.hubspot_contact_id,
      source: "prospecting",
      source_id: touch.id,
      subject: sent.subject,
      body: sent.body,
      recipient_kind: "to",
      sender_email: sent.fromEmail,
      scope_company_id: contact.scope_company_id,
      sent_at: sentAt,
    });
    if (logErr) console.error("[prospecting] outreach_log insert failed:", logErr.message);
  }

  await logEvent({
    type: "sent",
    userId: enrollment.user_id,
    campaignId: enrollment.campaign_id,
    enrollmentId: enrollment.id,
    contactId: enrollment.contact_id,
    touchId: touch.id,
    stepPosition: touch.position,
    data: { gmailMessageId: sent.messageId, threadId: sent.threadId, recovered: !!input.recovered },
  });

  const touches = input.touches.map((t) => (t.id === touch.id ? { ...t, status: "sent" as TouchStatus } : t));
  if (!touches.some((t) => t.id === touch.id)) touches.push({ ...touch, status: "sent" });
  await advanceAfterExecution({
    enrollment,
    campaign,
    steps: input.steps,
    touches,
    executedAt: sent.sentAt,
    executedPosition: touch.position,
  });
  await setContactStatus(contact.id, "in_sequence", ["new"]);

  await logSentToHubspot(input).catch((e) => console.error("[prospecting] hubspot log failed:", errMessage(e)));
  return true;
}

async function logSentToHubspot(input: FinalizeInput): Promise<void> {
  const { campaign, contact, enrollment, touch, sent } = input;
  const s = campaign.settings;
  if (!s.hubspotLogEmails && !s.hubspotCreateContacts) return;
  const failed = (step: string, error: string) =>
    logEvent({
      type: "hubspot_failed",
      userId: enrollment.user_id,
      campaignId: enrollment.campaign_id,
      enrollmentId: enrollment.id,
      contactId: enrollment.contact_id,
      touchId: touch.id,
      data: { step, error },
    });

  if (!contact.hubspot_contact_id && s.hubspotCreateContacts) {
    const ensured = await ensureHubspotContactDetailed(contact, enrollment.user_id);
    if (ensured.error) await failed("create_contact", ensured.error);
  }
  if (!s.hubspotLogEmails) return;
  const logged = await logEmailToHubspotDetailed({
    contact,
    userId: enrollment.user_id,
    direction: "out",
    subject: sent.subject,
    body: sent.body,
    at: sent.sentAt.toISOString(),
    fromEmail: sent.fromEmail,
    toEmail: contact.email,
  });
  if (logged.id) {
    await db.from("prospecting_touches").update({ hubspot_engagement_id: logged.id }).eq("id", touch.id);
  } else if (logged.error) {
    await failed("log_email", logged.error);
  }
}
