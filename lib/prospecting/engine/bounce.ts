// Détection déterministe des bounces (DSN). Module pur.
// - Expéditeur mailer-daemon / postmaster, ou Content-Type multipart/report
//   (report-type=delivery-status).
// - Gravité : code SMTP étendu 5.x.x = hard, 4.x.x = soft. Sans code, mots-clés
//   explicites ("user unknown", "address not found"...) = hard ; sinon soft :
//   dans le doute on ne supprime pas un email (une suppression est définitive).

export type BounceSeverity = "hard" | "soft";

export interface ParsedBounce {
  recipient: string | null;
  /** Tous les emails trouvés dans le DSN (pour un rapprochement avec nos contacts). */
  emails: string[];
  severity: BounceSeverity;
  code: string | null;
}

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const HARD_KEYWORDS = [
  "address not found",
  "user unknown",
  "unknown user",
  "no such user",
  "does not exist",
  "doesn't exist",
  "recipient address rejected",
  "mailbox unavailable",
  "mailbox not found",
  "invalid recipient",
  "recipient not found",
  "account has been disabled",
  "account is disabled",
  "adresse introuvable",
  "n'existe pas",
  "destinataire inconnu",
];

export function isBounceMessage(fromEmail: string | null | undefined, headers: Record<string, string>): boolean {
  if (fromEmail && BOUNCE_SENDER_RE.test(fromEmail.trim())) return true;
  const ct = (headers["content-type"] ?? "").toLowerCase();
  return ct.includes("multipart/report") && ct.includes("delivery-status");
}

function firstEmail(text: string | null | undefined): string | null {
  const m = (text ?? "").match(EMAIL_RE);
  return m && m[0] ? m[0].toLowerCase() : null;
}

export function parseBounce(headers: Record<string, string>, body: string | null | undefined): ParsedBounce {
  const text = body ?? "";
  const lower = text.toLowerCase();

  const ignored = /^(mailer-daemon|postmaster|mail-daemon|noreply|no-reply)@/i;
  const emails = Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))).filter((e) => !ignored.test(e));

  let recipient = firstEmail(headers["x-failed-recipients"]);
  if (!recipient) {
    const m = /(?:final|original)-recipient:\s*(?:rfc822;)?\s*<?([^\s>;]+@[^\s>;]+)>?/i.exec(text);
    if (m) recipient = m[1].toLowerCase();
  }
  if (!recipient) recipient = emails[0] ?? null;

  const codes = Array.from(text.matchAll(/\b([245])\.(\d{1,3})\.(\d{1,3})\b/g)).map((m) => m[0]);
  const hardCode = codes.find((c) => c.startsWith("5."));
  const softCode = codes.find((c) => c.startsWith("4."));
  let severity: BounceSeverity;
  let code: string | null = null;
  if (hardCode) {
    severity = "hard";
    code = hardCode;
  } else if (softCode) {
    severity = "soft";
    code = softCode;
  } else {
    severity = HARD_KEYWORDS.some((k) => lower.includes(k)) ? "hard" : "soft";
  }
  return { recipient, emails, severity, code };
}
