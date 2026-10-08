// Vue Replies (qui m'a répondu) : définitions partagées client + serveur.
// Module pur. Aucune IA sur les réponses : une réponse humaine arrête la
// séquence et déclenche un DM Slack au rep (moteur, sync.ts) ; les
// auto-réponses et bounces sont détectés par les en-têtes email.
import type { ContactRow, EnrollmentRow, InboxItem, ReplyKind, ReplyRow, TouchRow } from "../types";

export type ReplyFilter = "replies" | "auto_reply" | "bounce" | "all";

export const REPLY_FILTERS: { key: ReplyFilter; label: string; hint: string }[] = [
  { key: "replies", label: "Replies", hint: "Answers from the prospect or a colleague: the sequence stopped and you got a Slack message" },
  { key: "auto_reply", label: "Auto-replies", hint: "Out-of-office and other automatic emails: the sequence pauses 5 sending days" },
  { key: "bounce", label: "Bounces", hint: "Undelivered emails: the address goes to the do-not-contact list" },
  { key: "all", label: "Everything", hint: "All detected messages" },
];

export const FILTER_KEYS = REPLY_FILTERS.map((f) => f.key);

export function isReplyFilter(v: string | null | undefined): v is ReplyFilter {
  return !!v && (FILTER_KEYS as string[]).includes(v);
}

/** Types de messages qui sont de vraies réponses humaines. */
export const HUMAN_KINDS: ReplyKind[] = ["reply", "colleague_reply"];

/** Appartenance d'une réponse à un filtre (miroir des filtres SQL de GET /api/prospecting/replies). */
export function matchesFilter(r: Pick<ReplyRow, "kind">, filter: ReplyFilter): boolean {
  switch (filter) {
    case "replies":
      return HUMAN_KINDS.includes(r.kind);
    case "auto_reply":
      return r.kind === "auto_reply";
    case "bounce":
      return r.kind === "bounce";
    default:
      return true;
  }
}

export type KindTone = "ok" | "info" | "neutral" | "err";

/** Libellé + tonalité d'un message reçu. */
export function displayKind(r: Pick<ReplyRow, "kind" | "category">): { label: string; tone: KindTone } {
  switch (r.kind) {
    case "reply":
      return { label: "Replied", tone: "ok" };
    case "colleague_reply":
      return { label: "Colleague replied", tone: "info" };
    case "auto_reply":
      return { label: "Auto-reply", tone: "neutral" };
    default:
      return { label: r.category === "bounce_soft" ? "Soft bounce" : "Bounce", tone: "err" };
  }
}

// ── DTO d'API ───────────────────────────────────────────────────────────────

export interface RepliesListResponse {
  items: InboxItem[];
  counts: Record<ReplyFilter, number>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ReplyDetailResponse {
  reply: InboxItem;
  /** Nos emails envoyés à ce prospect (du plus ancien au plus récent) + réponses du fil. */
  thread: { touches: TouchRow[]; replies: ReplyRow[] };
  enrollment: EnrollmentRow | null;
  contact: ContactRow | null;
  campaign: { id: string; name: string; status: string; kind?: string } | null;
  /** Adresse de la boîte qui a reçu la réponse (lien "Open in Gmail"). */
  mailbox: { email: string | null; provider: string } | null;
}

/** Lien direct vers le fil dans Gmail (compte de la boîte d'envoi). */
export function gmailThreadUrl(threadId: string | null | undefined, mailboxEmail: string | null | undefined): string | null {
  if (!threadId) return null;
  const account = mailboxEmail ? `?authuser=${encodeURIComponent(mailboxEmail)}` : "";
  return `https://mail.google.com/mail/u/0/${account}#all/${threadId}`;
}
