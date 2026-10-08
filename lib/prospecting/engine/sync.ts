// Synchro des réponses d'une boîte (toujours AVANT l'envoi, pour qu'une réponse
// arrête la séquence avant la relance suivante).
//
// Source : Gmail History API depuis last_history_id (scope gmail.readonly).
// Si l'historique a expiré (> ~1 semaine sans synchro) : relecture des threads
// des emails envoyés < 30 j (50 max) + recherche `from:` des prospects vivants
// sur 7 jours, puis réinitialisation du curseur.
//
// Rapprochement d'un message entrant, dans l'ordre :
// 1. bounce (mailer-daemon / postmaster / multipart/report) ;
// 2. thread connu (une de nos touches y est) -> réponse du prospect ;
// 3. In-Reply-To / References contenant un de nos Message-ID -> réponse ;
// 4. expéditeur = email d'un prospect vivant de la boîte -> réponse ;
// 5. expéditeur du même domaine (non grand public) qu'un prospect vivant ->
//    réponse d'un collègue.
// Un message SENT dans un thread connu qui n'est pas une de nos touches = le
// rep a répondu à la main : la séquence de ce prospect est mise en pause.
import { db } from "@/lib/db";
import {
  GmailAuthError,
  GmailHistoryExpiredError,
  getGmailMessageFull,
  getGmailProfile,
  getGmailThread,
  getMessageHeaders,
  listGmailHistory,
  listGmailMessageIds,
  type GmailMessageMeta,
} from "@/lib/gmail";
import { logEmailToHubspotDetailed, ensureHubspotContactDetailed } from "../hubspot-log";
import { addSendDays, localDay, windowStartUtc } from "../schedule";
import { getCampaign } from "../store/campaigns";
import { logEvent } from "../store/events";
import { addSuppression } from "../store/suppressions";
import { businessDomain, chunk, domainOfEmail, errMessage, isPublicEmailDomain, nowIso } from "../store/util";
import type { CampaignRow, ContactRow, EnrollmentRow, MailboxRow, ReplyCategory, ReplyKind, SyncSummary, TouchRow } from "../types";
import { setContactStatus, stopSequence } from "./advance";
import { detectAutoReply } from "./auto-reply";
import { isBounceMessage, parseBounce } from "./bounce";
import { emptySyncSummary, timeLeft, type EngineContext } from "./context";
import { markMailboxDisconnected } from "./mailbox-state";
import { notifyRep } from "./notify";
import { canonicalMessageId, parseAddress, parseMessageIds } from "./thread";
import { stripQuoted } from "../lint";
import { appUrl } from "./context";

const HEADER_NAMES = [
  "From",
  "To",
  "Subject",
  "Message-ID",
  "In-Reply-To",
  "References",
  "Date",
  "Auto-Submitted",
  "X-Autoreply",
  "X-Autorespond",
  "Precedence",
  "X-Failed-Recipients",
  "Content-Type",
];
const MAX_HISTORY_PAGES = 20;
const FALLBACK_MAX_THREADS = 50;
const MIN_TIME_LEFT_MS = 20_000;
const OOO_PAUSE_SEND_DAYS = 5;
const BOUNCE_GUARD_MIN_SENT = 20;
const BOUNCE_GUARD_RATE = 0.03;

const LIVE: EnrollmentRow["status"][] = ["active", "paused"];

interface Candidate {
  id: string;
  threadId: string;
  labelIds: string[] | null;
  meta?: GmailMessageMeta;
}

type SentTouch = Pick<
  TouchRow,
  "id" | "enrollment_id" | "campaign_id" | "position" | "status" | "sent_at" | "gmail_message_id" | "gmail_thread_id" | "rfc_message_id" | "subject"
>;
const SENT_TOUCH_COLUMNS = "id, enrollment_id, campaign_id, position, status, sent_at, gmail_message_id, gmail_thread_id, rfc_message_id, subject";

/** Caches et contexte d'une synchro. */
interface SyncState {
  mailbox: MailboxRow;
  mailboxEmail: string | null;
  ctx: EngineContext;
  summary: SyncSummary;
  enrollments: Map<string, EnrollmentRow | null>;
  contacts: Map<string, ContactRow | null>;
  campaigns: Map<string, CampaignRow | null>;
  bounceGuardChecked: boolean;
}

export async function syncMailbox(mailbox: MailboxRow, ctx: EngineContext): Promise<SyncSummary> {
  const summary = emptySyncSummary("history");
  if (ctx.dryRun || mailbox.status === "disconnected") {
    summary.mode = "skipped";
    return summary;
  }
  const userId = mailbox.user_id;
  const provider = mailbox.provider;
  const state: SyncState = {
    mailbox,
    mailboxEmail: mailbox.email_address?.toLowerCase() ?? null,
    ctx,
    summary,
    enrollments: new Map(),
    contacts: new Map(),
    campaigns: new Map(),
    bounceGuardChecked: false,
  };

  try {
    let candidates: Candidate[] = [];
    let newHistoryId: string | null = null;

    if (!mailbox.last_history_id) {
      // Premier passage : curseur pris AVANT le rattrapage pour ne rien perdre.
      const profile = await getGmailProfile(userId, provider);
      newHistoryId = profile.historyId;
      state.mailboxEmail ??= profile.emailAddress.toLowerCase();
      summary.mode = "init";
      if (await hasRecentSent(userId)) candidates = await fallbackCandidates(state);
    } else {
      try {
        const res = await collectHistory(userId, mailbox.last_history_id, provider);
        candidates = res.candidates;
        newHistoryId = res.historyId ?? mailbox.last_history_id;
      } catch (e) {
        if (!(e instanceof GmailHistoryExpiredError)) throw e;
        const profile = await getGmailProfile(userId, provider);
        newHistoryId = profile.historyId;
        summary.mode = "fallback";
        candidates = await fallbackCandidates(state);
      }
    }

    const complete = await processCandidates(state, candidates);
    const patch: Record<string, unknown> = { last_synced_at: nowIso(), sync_error: null, updated_at: nowIso() };
    // Curseur avancé seulement si tout a été traité (sinon relecture au prochain
    // tick : le traitement est idempotent).
    if (complete) patch.last_history_id = newHistoryId;
    if (!mailbox.email_address && state.mailboxEmail) patch.email_address = state.mailboxEmail;
    await db.from("prospecting_mailboxes").update(patch).eq("id", mailbox.id);
  } catch (e) {
    const message = errMessage(e);
    summary.error = message;
    // 401 = jeton refusé par Gmail (révoqué entre deux rafraîchissements).
    if (e instanceof GmailAuthError || /HTTP 401\b/.test(message)) {
      await markMailboxDisconnected(mailbox, message);
    } else {
      await db
        .from("prospecting_mailboxes")
        .update({ sync_error: `Could not check replies: ${message}`.slice(0, 500), updated_at: nowIso() })
        .eq("id", mailbox.id);
    }
  }
  return summary;
}

async function hasRecentSent(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { count } = await db
    .from("prospecting_touches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("sent_at", since);
  return (count ?? 0) > 0;
}

async function collectHistory(userId: string, startHistoryId: string, provider: MailboxRow["provider"]) {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let pageToken: string | null = null;
  let historyId: string | null = null;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const res = await listGmailHistory(userId, startHistoryId, pageToken, provider);
    for (const m of res.messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      candidates.push({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
    }
    historyId = res.historyId ?? historyId;
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return { candidates, historyId };
}

/** History expirée : threads des emails envoyés < 30 j + recherche `from:` des prospects vivants. */
async function fallbackCandidates(state: SyncState): Promise<Candidate[]> {
  const { mailbox } = state;
  const userId = mailbox.user_id;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: sentRows } = await db
    .from("prospecting_touches")
    .select("enrollment_id, gmail_thread_id, sent_at")
    .eq("user_id", userId)
    .eq("status", "sent")
    .eq("kind", "email")
    .gte("sent_at", since)
    .not("gmail_thread_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1000);
  const sent = (sentRows ?? []) as { enrollment_id: string; gmail_thread_id: string; sent_at: string }[];

  // Priorité aux threads des séquences encore vivantes.
  const liveIds = new Set<string>();
  for (const part of chunk(Array.from(new Set(sent.map((s) => s.enrollment_id))), 200)) {
    const { data } = await db.from("prospecting_enrollments").select("id").in("id", part).in("status", LIVE);
    for (const r of (data ?? []) as { id: string }[]) liveIds.add(r.id);
  }
  const ordered = [...sent].sort((a, b) => Number(liveIds.has(b.enrollment_id)) - Number(liveIds.has(a.enrollment_id)));
  const threads = Array.from(new Set(ordered.map((s) => s.gmail_thread_id))).slice(0, FALLBACK_MAX_THREADS);

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const threadId of threads) {
    if (timeLeft(state.ctx) < MIN_TIME_LEFT_MS * 2) break;
    try {
      const thread = await getGmailThread(userId, threadId, mailbox.provider);
      for (const m of thread.messages) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, meta: m });
      }
    } catch (e) {
      console.error("[prospecting] fallback thread read failed:", errMessage(e));
    }
  }

  // Réponses hors thread des prospects vivants (7 derniers jours), par paquets de 20.
  const { data: liveEnr } = await db.from("prospecting_enrollments").select("contact_id").eq("user_id", userId).in("status", LIVE).limit(1000);
  const contactIds = Array.from(new Set(((liveEnr ?? []) as { contact_id: string }[]).map((r) => r.contact_id)));
  const emails: string[] = [];
  for (const part of chunk(contactIds, 200)) {
    const { data } = await db.from("prospecting_contacts").select("email_lower").in("id", part).not("email_lower", "is", null);
    for (const r of (data ?? []) as { email_lower: string }[]) emails.push(r.email_lower);
  }
  for (const part of chunk(emails, 20)) {
    if (timeLeft(state.ctx) < MIN_TIME_LEFT_MS * 2) break;
    try {
      const ids = await listGmailMessageIds(userId, `from:(${part.join(" OR ")}) newer_than:7d`, 50, mailbox.provider);
      for (const m of ids) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ id: m.id, threadId: m.threadId, labelIds: null });
      }
    } catch (e) {
      console.error("[prospecting] fallback search failed:", errMessage(e));
    }
  }
  return out;
}

// ── Traitement ────────────────────────────────────────────────────────────────

async function processCandidates(state: SyncState, all: Candidate[]): Promise<boolean> {
  const { mailbox, summary } = state;
  const userId = mailbox.user_id;
  const candidates = all.filter((c) => !(c.labelIds ?? []).includes("DRAFT"));
  if (candidates.length === 0) return true;

  // Déjà en base (idempotence).
  const known = new Set<string>();
  for (const part of chunk(candidates.map((c) => c.id), 200)) {
    const { data } = await db.from("prospecting_replies").select("gmail_message_id").eq("user_id", userId).in("gmail_message_id", part);
    for (const r of (data ?? []) as { gmail_message_id: string }[]) known.add(r.gmail_message_id);
  }
  const todo = candidates.filter((c) => !known.has(c.id));

  // Nos touches présentes dans ces threads / ces messages.
  const byThread = new Map<string, SentTouch[]>();
  const ourMessageIds = new Set<string>();
  for (const part of chunk(Array.from(new Set(todo.map((c) => c.threadId))), 200)) {
    const { data } = await db.from("prospecting_touches").select(SENT_TOUCH_COLUMNS).eq("user_id", userId).in("gmail_thread_id", part);
    for (const t of (data ?? []) as SentTouch[]) {
      const list = byThread.get(t.gmail_thread_id as string) ?? [];
      list.push(t);
      byThread.set(t.gmail_thread_id as string, list);
      if (t.gmail_message_id) ourMessageIds.add(t.gmail_message_id);
    }
  }
  for (const part of chunk(todo.map((c) => c.id), 200)) {
    const { data } = await db.from("prospecting_touches").select("gmail_message_id").eq("user_id", userId).in("gmail_message_id", part);
    for (const t of (data ?? []) as { gmail_message_id: string }[]) ourMessageIds.add(t.gmail_message_id);
  }

  for (const c of todo) {
    if (timeLeft(state.ctx) < MIN_TIME_LEFT_MS) return false;
    summary.scanned++;
    try {
      if (ourMessageIds.has(c.id)) continue;
      let meta = c.meta;
      if (!c.labelIds) {
        meta = await getMessageHeaders(userId, c.id, HEADER_NAMES, mailbox.provider);
        c.labelIds = meta.labelIds;
      }
      const labels = c.labelIds ?? [];
      if (labels.includes("DRAFT")) continue;
      const threadTouches = byThread.get(c.threadId) ?? [];

      if (labels.includes("SENT")) {
        if (threadTouches.length) await handleManualReply(state, threadTouches, c.id);
        continue;
      }
      meta ??= await getMessageHeaders(userId, c.id, HEADER_NAMES, mailbox.provider);
      await handleInbound(state, meta, threadTouches);
    } catch (e) {
      if (e instanceof GmailAuthError) throw e;
      console.error(`[prospecting] sync message ${c.id} failed:`, errMessage(e));
    }
  }
  return true;
}

/** Le rep a écrit à la main dans un thread de séquence : on met le prospect en pause. */
async function handleManualReply(state: SyncState, threadTouches: SentTouch[], messageId: string): Promise<void> {
  const enrollmentId = threadTouches[0].enrollment_id;
  // Un envoi du moteur en cours de réconciliation n'est pas une réponse manuelle.
  const { count: sending } = await db
    .from("prospecting_touches")
    .select("id", { count: "exact", head: true })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "sending");
  if ((sending ?? 0) > 0) return;
  const { data } = await db
    .from("prospecting_enrollments")
    .update({ status: "paused", pause_reason: "manual_reply", updated_at: nowIso() })
    .eq("id", enrollmentId)
    .eq("status", "active")
    .select("id, campaign_id, contact_id, user_id");
  if (!data?.length) return;
  const e = data[0] as { id: string; campaign_id: string; contact_id: string; user_id: string };
  state.summary.manualReplies++;
  await logEvent({
    type: "paused",
    userId: e.user_id,
    campaignId: e.campaign_id,
    enrollmentId: e.id,
    contactId: e.contact_id,
    data: { reason: "manual_reply", gmailMessageId: messageId },
  });
}

interface Match {
  enrollment: EnrollmentRow;
  contact: ContactRow;
  kind: ReplyKind;
}

async function handleInbound(state: SyncState, meta: GmailMessageMeta, threadTouches: SentTouch[]): Promise<void> {
  const { mailbox, summary } = state;
  const userId = mailbox.user_id;
  const from = parseAddress(meta.headers["from"]);
  if (from.email && state.mailboxEmail && from.email === state.mailboxEmail) return;
  const subject = meta.headers["subject"] ?? "";
  const receivedAt = meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : nowIso();

  // 1. Bounce.
  if (isBounceMessage(from.email, meta.headers)) {
    const full = await getGmailMessageFull(userId, meta.id, mailbox.provider);
    const parsed = parseBounce(meta.headers, full.body);
    let match = threadTouches.length ? await matchByEnrollment(state, threadTouches[0].enrollment_id, "bounce") : null;
    if (!match) {
      for (const email of [parsed.recipient, ...parsed.emails].filter((x): x is string => !!x)) {
        match = await matchByEmail(state, email, "bounce", true);
        if (match) break;
      }
    }
    if (!match) return;
    const category: ReplyCategory = parsed.severity === "hard" ? "bounce_hard" : "bounce_soft";
    const replyId = await insertReply(state, meta, match, {
      kind: "bounce",
      category,
      body: full.body,
      receivedAt,
      from,
      subject,
      classified: true,
      summary:
        parsed.severity === "hard"
          ? `Hard bounce: the address does not accept email${parsed.code ? ` (SMTP ${parsed.code})` : ""}.`
          : `Temporary delivery problem${parsed.code ? ` (SMTP ${parsed.code})` : ""}. The sequence continues.`,
    });
    if (!replyId) return;
    summary.bounces++;
    if (parsed.severity === "hard") await applyHardBounce(state, match, replyId, parsed.code);
    else
      await logEvent({
        type: "soft_bounce",
        userId,
        campaignId: match.enrollment.campaign_id,
        enrollmentId: match.enrollment.id,
        contactId: match.contact.id,
        data: { replyId, code: parsed.code },
      });
    return;
  }

  // 2-5. Rapprochement.
  let match: Match | null = null;
  if (threadTouches.length) match = await matchByEnrollment(state, threadTouches[0].enrollment_id, "reply");
  if (!match) {
    const refs = Array.from(new Set([...parseMessageIds(meta.headers["in-reply-to"]), ...parseMessageIds(meta.headers["references"])]));
    if (refs.length) {
      const { data } = await db.from("prospecting_touches").select("enrollment_id").eq("user_id", userId).in("rfc_message_id", refs).limit(1);
      const enrId = (data?.[0] as { enrollment_id: string } | undefined)?.enrollment_id;
      if (enrId) match = await matchByEnrollment(state, enrId, "reply");
    }
  }
  if (!match && from.email) match = await matchByEmail(state, from.email, "reply", false);
  if (!match && from.email) match = await matchByDomain(state, from.email);
  if (!match) return;

  const auto = detectAutoReply(meta.headers, subject);
  if (auto.auto && match.kind === "colleague_reply") return; // auto-réponse d'un tiers : bruit
  const kind: ReplyKind = auto.auto ? "auto_reply" : match.kind;
  const full = await getGmailMessageFull(userId, meta.id, mailbox.provider);
  const replyId = await insertReply(state, meta, { ...match, kind }, { kind, category: null, body: full.body, receivedAt, from, subject, classified: false });
  if (!replyId) return;

  if (kind === "auto_reply") {
    summary.autoReplies++;
    await applyAutoReply(state, match, replyId);
  } else if (kind === "colleague_reply") {
    summary.colleagueReplies++;
    await applyColleagueReply(state, match, replyId, { subject, body: full.body, fromEmail: from.email, fromName: from.name });
  } else {
    summary.replies++;
    await applyHumanReply(state, match, replyId, receivedAt, { subject, body: full.body, fromEmail: from.email });
  }
}

// ── Rapprochement ─────────────────────────────────────────────────────────────

async function loadEnrollment(state: SyncState, id: string): Promise<EnrollmentRow | null> {
  if (state.enrollments.has(id)) return state.enrollments.get(id) ?? null;
  const { data } = await db.from("prospecting_enrollments").select("*").eq("id", id).maybeSingle();
  const row = (data as EnrollmentRow | null) ?? null;
  state.enrollments.set(id, row);
  return row;
}

async function loadContact(state: SyncState, id: string): Promise<ContactRow | null> {
  if (state.contacts.has(id)) return state.contacts.get(id) ?? null;
  const { data } = await db.from("prospecting_contacts").select("*").eq("id", id).maybeSingle();
  const row = (data as ContactRow | null) ?? null;
  state.contacts.set(id, row);
  return row;
}

async function loadCampaign(state: SyncState, id: string): Promise<CampaignRow | null> {
  if (state.campaigns.has(id)) return state.campaigns.get(id) ?? null;
  const row = await getCampaign(id);
  state.campaigns.set(id, row);
  return row;
}

async function matchByEnrollment(state: SyncState, enrollmentId: string, kind: ReplyKind): Promise<Match | null> {
  const enrollment = await loadEnrollment(state, enrollmentId);
  if (!enrollment || enrollment.user_id !== state.mailbox.user_id) return null;
  const contact = await loadContact(state, enrollment.contact_id);
  return contact ? { enrollment, contact, kind } : null;
}

/**
 * Prospect de la boîte par email : séquence vivante en priorité, sinon une
 * séquence récente (terminée < 30 j) pour ne pas perdre une réponse tardive.
 * `anyStatus` (bounces) : n'importe quelle séquence ayant envoyé un email.
 */
async function matchByEmail(state: SyncState, email: string, kind: ReplyKind, anyStatus: boolean): Promise<Match | null> {
  const userId = state.mailbox.user_id;
  const { data: contactRows } = await db.from("prospecting_contacts").select("*").eq("email_lower", email.toLowerCase()).limit(1);
  const contact = (contactRows?.[0] as ContactRow | undefined) ?? null;
  if (!contact) return null;
  state.contacts.set(contact.id, contact);
  const { data } = await db
    .from("prospecting_enrollments")
    .select("*")
    .eq("user_id", userId)
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as EnrollmentRow[];
  const since = Date.now() - 30 * 86_400_000;
  const enrollment =
    rows.find((r) => LIVE.includes(r.status)) ??
    rows.find((r) => (anyStatus ? !!r.started_at : r.status === "completed") && new Date(r.last_activity_at ?? r.updated_at).getTime() > since) ??
    null;
  if (!enrollment) return null;
  state.enrollments.set(enrollment.id, enrollment);
  return { enrollment, contact, kind };
}

/** Contacts d'une entreprise : domaine explicite ou domaine de l'email. */
async function contactsOfDomain(domain: string): Promise<ContactRow[]> {
  const [byDomain, byEmail] = await Promise.all([
    db.from("prospecting_contacts").select("*").eq("company_domain", domain).limit(300),
    db.from("prospecting_contacts").select("*").like("email_lower", `%@${domain}`).limit(300),
  ]);
  const out = new Map<string, ContactRow>();
  for (const c of [...((byDomain.data ?? []) as ContactRow[]), ...((byEmail.data ?? []) as ContactRow[])]) out.set(c.id, c);
  return Array.from(out.values());
}

/** Collègue d'un prospect vivant (même domaine d'entreprise, hors domaines grand public). */
async function matchByDomain(state: SyncState, fromEmail: string): Promise<Match | null> {
  const domain = domainOfEmail(fromEmail);
  if (!domain || isPublicEmailDomain(domain)) return null;
  const contacts = await contactsOfDomain(domain);
  if (!contacts.length) return null;
  const { data } = await db
    .from("prospecting_enrollments")
    .select("*")
    .eq("user_id", state.mailbox.user_id)
    .in("status", LIVE)
    .in("contact_id", contacts.map((c) => c.id))
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const enrollment = (data?.[0] as EnrollmentRow | undefined) ?? null;
  if (!enrollment) return null;
  const contact = contacts.find((c) => c.id === enrollment.contact_id) as ContactRow;
  state.enrollments.set(enrollment.id, enrollment);
  state.contacts.set(contact.id, contact);
  return { enrollment, contact, kind: "colleague_reply" };
}

// ── Écriture de la réponse ────────────────────────────────────────────────────

async function insertReply(
  state: SyncState,
  meta: GmailMessageMeta,
  match: Match,
  r: {
    kind: ReplyKind;
    category: ReplyCategory | null;
    body: string;
    receivedAt: string;
    from: { name: string | null; email: string | null };
    subject: string;
    classified: boolean;
    summary?: string | null;
  },
): Promise<string | null> {
  // Attribution : dernier email envoyé à ce prospect avant la réponse.
  const { data: lastTouch } = await db
    .from("prospecting_touches")
    .select("id")
    .eq("enrollment_id", match.enrollment.id)
    .eq("kind", "email")
    .eq("status", "sent")
    .lte("sent_at", r.receivedAt)
    .order("sent_at", { ascending: false })
    .limit(1);
  const row = {
    user_id: state.mailbox.user_id,
    enrollment_id: match.enrollment.id,
    contact_id: match.contact.id,
    campaign_id: match.enrollment.campaign_id,
    touch_id: (lastTouch?.[0] as { id: string } | undefined)?.id ?? null,
    gmail_message_id: meta.id,
    gmail_thread_id: meta.threadId,
    rfc_message_id: canonicalMessageId(meta.headers["message-id"]),
    from_email: r.from.email,
    from_name: r.from.name,
    subject: r.subject || null,
    snippet: meta.snippet || null,
    body: r.body ? r.body.slice(0, 50_000) : null,
    received_at: r.receivedAt,
    kind: r.kind,
    category: r.category,
    classified_at: r.classified ? nowIso() : null,
    summary: r.summary ?? null,
  };
  const { data, error } = await db
    .from("prospecting_replies")
    .upsert(row, { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`reply insert: ${error.message}`);
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

// ── Effets des réponses (déterministes, aucune IA) ───────────────────────────

async function applyHumanReply(
  state: SyncState,
  match: Match,
  replyId: string,
  receivedAt: string,
  msg: { subject: string; body: string; fromEmail: string | null },
): Promise<void> {
  const { enrollment, contact } = match;
  const stopped = await stopSequence({
    enrollment,
    status: "replied",
    fromStatuses: ["active", "paused", "completed", "stopped", "error", "pending"],
    repliedAt: receivedAt,
    eventType: "replied",
    eventData: { replyId },
    cancelReason: "Prospect replied",
  });
  if (!stopped) {
    // Déjà arrêtée (réponse précédente, bounce...) : on garde au moins la date de réponse.
    await db.from("prospecting_enrollments").update({ replied_at: receivedAt }).eq("id", enrollment.id).is("replied_at", null);
  }
  await setContactStatus(contact.id, "replied", ["new", "in_sequence"]);

  const campaign = await loadCampaign(state, enrollment.campaign_id);
  if (!campaign) return;
  if (campaign.settings.hubspotLogEmails) await logReplyToHubspot(state, match, replyId, receivedAt, msg, campaign);
  if (campaign.settings.stopOnCompanyReply) {
    const domain = businessDomain(contact.company_domain, contact.email);
    if (domain) await stopCompany(state, domain, enrollment.id, replyId);
  }
  await notifyReply(state, match, campaign, replyId, msg, null);
}

async function applyColleagueReply(
  state: SyncState,
  match: Match,
  replyId: string,
  msg: { subject: string; body: string; fromEmail: string | null; fromName: string | null },
): Promise<void> {
  // Toute réponse arrête la séquence, y compris celle d'un collègue du prospect.
  await stopSequence({
    enrollment: match.enrollment,
    status: "stopped",
    stopReason: "colleague_replied",
    eventType: "stopped",
    eventData: { reason: "colleague_replied", replyId },
    cancelReason: "A colleague replied",
  });
  const campaign = await loadCampaign(state, match.enrollment.campaign_id);
  if (campaign?.settings.stopOnCompanyReply) {
    const domain = businessDomain(match.contact.company_domain, match.contact.email) ?? domainOfEmail(msg.fromEmail);
    if (domain) await stopCompany(state, domain, null, replyId);
  }
  if (campaign) await notifyReply(state, match, campaign, replyId, msg, msg.fromName || msg.fromEmail);
}

/**
 * DM Slack au rep à chaque réponse humaine, quel que soit son contenu (aucune
 * IA) : qui, quelle campagne, le début du message, lien vers Replies.
 */
async function notifyReply(
  state: SyncState,
  match: Match,
  campaign: CampaignRow,
  replyId: string,
  msg: { subject: string; body: string },
  colleagueName: string | null,
): Promise<void> {
  if (state.ctx.dryRun) return;
  const c = match.contact;
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "A prospect";
  const company = c.company_name ? ` (${c.company_name})` : "";
  const who = colleagueName ? `*${colleagueName}*, colleague of ${name}${company},` : `*${name}*${company}`;
  const excerpt = stripQuoted(msg.body ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  const lines = [
    `:incoming_envelope: ${who} replied to "${campaign.name}". The sequence is stopped.`,
    excerpt ? `>${excerpt}${excerpt.length >= 280 ? "..." : ""}` : null,
    `<${appUrl(`/prospecting/replies?reply=${replyId}`)}|Open in Prospecting>`,
  ].filter(Boolean);
  await notifyRep(state.mailbox.user_id, lines.join("\n"));
}

/** Arrête les séquences vivantes du rep pour cette entreprise (un collègue a répondu). */
async function stopCompany(state: SyncState, domain: string, exceptEnrollmentId: string | null, replyId: string): Promise<void> {
  const ids = (await contactsOfDomain(domain)).map((c) => c.id);
  if (!ids.length) return;
  for (const part of chunk(ids, 200)) {
    const { data } = await db
      .from("prospecting_enrollments")
      .select("id, campaign_id, contact_id, user_id")
      .eq("user_id", state.mailbox.user_id)
      .in("status", LIVE)
      .in("contact_id", part);
    for (const e of (data ?? []) as EnrollmentRow[]) {
      if (e.id === exceptEnrollmentId) continue;
      await stopSequence({
        enrollment: e,
        status: "stopped",
        stopReason: "company_replied",
        eventType: "stopped",
        eventData: { reason: "company_replied", replyId, domain },
        cancelReason: "Someone at the company replied",
      });
    }
  }
}

async function applyAutoReply(state: SyncState, match: Match, replyId: string): Promise<void> {
  const campaign = await loadCampaign(state, match.enrollment.campaign_id);
  const data: Record<string, unknown> = { replyId };
  if (campaign?.settings.pauseOnOoo) {
    // Pause de 5 jours d'envoi (reprise automatique à paused_until, cf.
    // resumeTimedPauses). Seulement depuis `active` :
    // une pause manuelle du rep ne doit jamais devenir une pause à reprise auto.
    const w = campaign.settings.window;
    const until = windowStartUtc(addSendDays(localDay(new Date(), w.timezone), OOO_PAUSE_SEND_DAYS, w), w).toISOString();
    // next_run_at null = attente d'une tâche "Wait until done" : on ne la court-circuite pas.
    const current = match.enrollment.next_run_at;
    const nextRun = current === null ? null : current > until ? current : until;
    const { data: upd } = await db
      .from("prospecting_enrollments")
      .update({ status: "paused", paused_until: until, next_run_at: nextRun, pause_reason: "out_of_office", updated_at: nowIso() })
      .eq("id", match.enrollment.id)
      .eq("status", "active")
      .select("id");
    if (upd?.length) data.pausedUntil = until;
  }
  await logEvent({
    type: "auto_replied",
    userId: match.enrollment.user_id,
    campaignId: match.enrollment.campaign_id,
    enrollmentId: match.enrollment.id,
    contactId: match.contact.id,
    data,
  });
}

async function applyHardBounce(state: SyncState, match: Match, replyId: string, code: string | null): Promise<void> {
  const { enrollment, contact } = match;
  await stopSequence({
    enrollment,
    status: "bounced",
    fromStatuses: ["active", "paused", "completed", "pending"],
    eventType: "bounced",
    eventData: { replyId, code, severity: "hard" },
    cancelReason: "Email bounced",
  });
  await db
    .from("prospecting_contacts")
    .update({ email_status: "bounced", status: "bounced", updated_at: nowIso() })
    .eq("id", contact.id);
  if (contact.email) {
    await addSuppression({ kind: "email", value: contact.email, reason: "bounce", sourceReplyId: replyId, createdBy: state.mailbox.user_id });
  }
  if (!state.bounceGuardChecked) {
    state.bounceGuardChecked = true;
    await bounceGuard(state);
  }
}

/** Taux de hard bounce 7 j > 3 % (sur au moins 20 envois) : pause de toutes les campagnes du rep. */
async function bounceGuard(state: SyncState): Promise<void> {
  const userId = state.mailbox.user_id;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ count: sent }, { count: bounces }] = await Promise.all([
    db.from("prospecting_touches").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "email").eq("status", "sent").gte("sent_at", since),
    db
      .from("prospecting_replies")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "bounce")
      .eq("category", "bounce_hard")
      .gte("received_at", since),
  ]);
  const s = sent ?? 0;
  const b = bounces ?? 0;
  if (s < BOUNCE_GUARD_MIN_SENT || b / s <= BOUNCE_GUARD_RATE) return;
  const { data: paused } = await db
    .from("prospecting_campaigns")
    .update({ status: "paused", pause_reason: "bounce_guard", updated_at: nowIso() })
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id, name");
  const rows = (paused ?? []) as { id: string; name: string }[];
  if (!rows.length) return;
  const rate = Math.round((b / s) * 1000) / 10;
  for (const c of rows) {
    await logEvent({ type: "paused", userId, campaignId: c.id, data: { reason: "bounce_guard", bounces: b, sent: s, rate } });
  }
  await notifyRep(
    userId,
    `Prospecting paused ${rows.length} campaign${rows.length > 1 ? "s" : ""} (${rows.map((c) => c.name).join(", ")}): ${b} hard bounces out of ${s} emails in the last 7 days (${rate}%, above the 3% safety limit). Clean the lists (invalid emails) before resuming: ${appUrl("/prospecting/campaigns")}`,
  );
}

async function logReplyToHubspot(
  state: SyncState,
  match: Match,
  replyId: string,
  receivedAt: string,
  msg: { subject: string; body: string; fromEmail: string | null },
  campaign: CampaignRow,
): Promise<void> {
  try {
    const contact = match.contact;
    if (!contact.hubspot_contact_id && campaign.settings.hubspotCreateContacts) {
      await ensureHubspotContactDetailed(contact, state.mailbox.user_id);
    }
    const res = await logEmailToHubspotDetailed({
      contact,
      userId: state.mailbox.user_id,
      direction: "in",
      subject: msg.subject,
      body: msg.body,
      at: receivedAt,
      fromEmail: msg.fromEmail,
      toEmail: state.mailboxEmail,
    });
    if (res.id) {
      await db.from("prospecting_replies").update({ hubspot_engagement_id: res.id }).eq("id", replyId);
    } else if (res.error) {
      await logEvent({
        type: "hubspot_failed",
        userId: state.mailbox.user_id,
        campaignId: match.enrollment.campaign_id,
        enrollmentId: match.enrollment.id,
        contactId: contact.id,
        data: { step: "log_reply", error: res.error, replyId },
      });
    }
  } catch (e) {
    console.error("[prospecting] hubspot reply log failed:", errMessage(e));
  }
}
