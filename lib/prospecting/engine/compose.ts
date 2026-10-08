// Composition de l'email final d'une touche : variables rendues, tirets longs
// retirés, signature, threading (In-Reply-To / References / "Re: <racine>"),
// citation du message précédent. Ne lève pas pour un contenu invalide : retourne
// une raison de blocage (le moteur relâche alors la touche).
import { db } from "@/lib/db";
import { buildRawEmail, getMessageHeaders, loadUserSignature } from "@/lib/gmail";
import { stripEmDashes } from "@/lib/no-em-dash";
import { hasBlockingIssue, lintMessage } from "../lint";
import { nowIso } from "../store/util";
import type { CampaignRow, ContactRow, LintIssue, MailboxRow, StepRow, TouchRow } from "../types";
import { findUnresolved, renderTemplate } from "../variables";
import { isFirstEmailStep } from "./next-step";
import { buildQuoted, canonicalMessageId, replySubject } from "./thread";

export type BlockReason =
  | "empty_body"
  | "missing_subject"
  | "unresolved_variable"
  | "lint_error"
  | "no_email"
  | "send_mode"
  | "suppressed"
  | "enrollment_inactive"
  | "campaign_inactive"
  | "mailbox_inactive"
  | "outdated_content";

export interface ComposedEmail {
  to: string;
  subject: string;
  /** Corps envoyé (sans signature ni citation) : c'est ce qui est journalisé. */
  body: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  isReply: boolean;
  lint: LintIssue[];
  raw: string;
}

export type ComposeResult = { ok: true; email: ComposedEmail } | { ok: false; reason: BlockReason; detail: string };

export type SignatureData = Awaited<ReturnType<typeof loadUserSignature>>;

export interface ComposeInput {
  mailbox: MailboxRow;
  fromEmail: string;
  campaign: CampaignRow;
  steps: StepRow[];
  step: StepRow;
  touch: TouchRow;
  /** Toutes les touches de l'enrollment (fraîches) : chaîne de threading. */
  touches: TouchRow[];
  contact: ContactRow;
  senderName: string | null;
  /** Cache de signature par user (un tick envoie plusieurs emails du même rep). */
  signatureCache?: Map<string, SignatureData>;
}

async function signatureFor(userId: string, cache?: Map<string, SignatureData>): Promise<SignatureData> {
  if (cache?.has(userId)) return cache.get(userId) ?? null;
  const sig = await loadUserSignature(userId).catch(() => null);
  cache?.set(userId, sig);
  return sig;
}

/** Message-ID RFC d'une touche envoyée, relu chez Gmail s'il manque (puis mémorisé). */
async function ensureRfcId(touch: TouchRow, mailbox: MailboxRow): Promise<string | null> {
  if (touch.rfc_message_id) return canonicalMessageId(touch.rfc_message_id);
  if (!touch.gmail_message_id) return null;
  try {
    const meta = await getMessageHeaders(mailbox.user_id, touch.gmail_message_id, ["Message-ID"], mailbox.provider);
    const id = canonicalMessageId(meta.headers["message-id"]);
    if (id) {
      touch.rfc_message_id = id;
      await db.from("prospecting_touches").update({ rfc_message_id: id, updated_at: nowIso() }).eq("id", touch.id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Emails déjà envoyés de l'enrollment, du plus ancien au plus récent. */
export function sentEmailChain(touches: TouchRow[]): TouchRow[] {
  return touches
    .filter((t) => t.kind === "email" && t.status === "sent")
    .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? "") || a.position - b.position);
}

export async function composeEmail(input: ComposeInput): Promise<ComposeResult> {
  const { mailbox, campaign, step, touch, contact } = input;
  const settings = campaign.settings;
  const to = (contact.email ?? "").trim();
  if (!to) return { ok: false, reason: "no_email", detail: "No email address" };

  // Contenu : la touche (IA ou éditée) ; en mode template sans contenu stocké,
  // le template de l'étape.
  let subjectSrc = touch.subject ?? "";
  let bodySrc = touch.body ?? "";
  if (step.config.mode === "template" && !bodySrc.trim()) {
    bodySrc = step.config.template.body;
    if (!subjectSrc.trim()) subjectSrc = step.config.template.subject;
  }
  const varCtx = { contact, senderName: input.senderName };
  const renderedBody = renderTemplate(bodySrc, varCtx);
  const renderedSubject = renderTemplate(subjectSrc, varCtx);
  const missing = Array.from(new Set([...renderedBody.missing, ...renderedSubject.missing]));
  if (missing.length) {
    return { ok: false, reason: "unresolved_variable", detail: `Missing value for ${missing.map((m) => `{{${m}}}`).join(", ")}` };
  }
  const body = stripEmDashes(renderedBody.text).trim();
  let subject = stripEmDashes(renderedSubject.text).trim();
  if (!body) return { ok: false, reason: "empty_body", detail: "Message is empty" };

  // Threading.
  const chain = sentEmailChain(input.touches.filter((t) => t.id !== touch.id));
  const prev = chain.length ? chain[chain.length - 1] : null;
  let threadId: string | null = null;
  let inReplyTo: string | null = null;
  let references: string[] = [];
  let quoted: { plain: string; html: string } | null = null;
  let isReply = false;

  if (step.thread_mode === "reply" && prev?.gmail_thread_id) {
    isReply = true;
    threadId = prev.gmail_thread_id;
    const thread = chain.filter((t) => t.gmail_thread_id === threadId);
    const root = thread[0] ?? prev;
    inReplyTo = await ensureRfcId(prev, mailbox);
    const ids: string[] = [];
    for (const t of thread) {
      const id = t.id === prev.id ? inReplyTo : canonicalMessageId(t.rfc_message_id);
      if (id && !ids.includes(id)) ids.push(id);
    }
    references = ids;
    subject = replySubject(root.subject) || replySubject(subject);
    if (settings.quotePrevious && prev.body) {
      quoted = buildQuoted({
        body: prev.body,
        sentAt: prev.sent_at,
        senderName: mailbox.from_name ?? input.senderName,
        senderEmail: input.fromEmail,
        timezone: mailbox.timezone,
      });
    }
  } else if (!subject && prev) {
    // Nouveau thread sans sujet propre : on reprend le sujet racine.
    subject = (chain.find((t) => t.gmail_thread_id === prev.gmail_thread_id) ?? prev).subject?.trim() ?? "";
  }
  if (!subject) return { ok: false, reason: "missing_subject", detail: "Email has no subject" };

  const leftover = [...findUnresolved(body), ...findUnresolved(subject)];
  if (leftover.length) {
    return { ok: false, reason: "unresolved_variable", detail: `Unresolved placeholder: ${Array.from(new Set(leftover)).join(", ")}` };
  }
  const lint = lintMessage({
    kind: "email",
    position: step.position,
    isReply,
    isFirstEmail: isFirstEmailStep(input.steps, step),
    subject,
    body,
    stepId: step.id,
  });
  if (hasBlockingIssue(lint)) {
    const first = lint.find((i) => i.level === "error");
    return { ok: false, reason: "lint_error", detail: first?.message ?? "Blocking lint issue" };
  }

  // Signature : sur le premier email envoyé ("first"), sur tous ("all") ou jamais.
  const wantSignature = settings.signature === "all" || (settings.signature === "first" && chain.length === 0);
  const signature = wantSignature ? await signatureFor(mailbox.user_id, input.signatureCache) : null;

  const raw = buildRawEmail({
    from: input.fromEmail,
    fromName: mailbox.from_name ?? input.senderName,
    to: [to],
    cc: [],
    bcc: [],
    subject,
    body,
    signature: signature ?? undefined,
    inReplyTo,
    references,
    quoted,
  });
  return { ok: true, email: { to, subject, body, threadId, inReplyTo, references, isReply, lint, raw } };
}
