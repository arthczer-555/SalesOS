// Helpers de threading email (sujets "Re:", citation du message précédent,
// parsing d'en-tête From). Module pur.
import { escapeHtml } from "@/lib/email/signature";

const RE_PREFIX = /^\s*(re|r|aw|sv|tr|fwd?|wg)\s*:\s*/i;

/** Sujet sans préfixes Re: / RE: / Fwd: répétés. */
export function stripReplyPrefixes(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  for (let i = 0; i < 10 && RE_PREFIX.test(s); i++) s = s.replace(RE_PREFIX, "").trim();
  return s;
}

/** Sujet d'une relance en thread : "Re: <sujet racine>", jamais "Re: Re:". */
export function replySubject(rootSubject: string | null | undefined): string {
  const base = stripReplyPrefixes(rootSubject);
  return base ? `Re: ${base}` : "";
}

/** Forme canonique pour comparer deux sujets (réconciliation d'envoi). */
export function normalizeSubject(subject: string | null | undefined): string {
  return stripReplyPrefixes(subject).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Décode les mots encodés RFC 2047 (=?UTF-8?B?...?= / =?UTF-8?Q?...?=). */
export function decodeMimeWords(input: string): string {
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    try {
      const label = charset.toLowerCase() === "utf8" ? "utf-8" : charset.toLowerCase();
      let bytes: Buffer;
      if (enc.toUpperCase() === "B") {
        bytes = Buffer.from(data, "base64");
      } else {
        const ascii = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
        bytes = Buffer.from(ascii, "latin1");
      }
      return new TextDecoder(label).decode(bytes);
    } catch {
      return data;
    }
  });
}

/** "Jane Doe <jane@acme.com>" -> { name, email } (email en minuscules). */
export function parseAddress(raw: string | null | undefined): { name: string | null; email: string | null } {
  const s = decodeMimeWords((raw ?? "").trim());
  if (!s) return { name: null, email: null };
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(s);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").trim();
    const email = angle[2].trim().toLowerCase();
    return { name: name || null, email: email.includes("@") ? email : null };
  }
  const m = /[^\s<>"]+@[^\s<>"]+/.exec(s);
  return { name: null, email: m ? m[0].toLowerCase() : null };
}

/** Liste d'adresses d'un en-tête To / Cc. */
export function parseAddressList(raw: string | null | undefined): string[] {
  const s = raw ?? "";
  return Array.from(new Set((s.match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((e) => e.toLowerCase())));
}

/** Message-IDs (<...>) contenus dans In-Reply-To / References. */
export function parseMessageIds(raw: string | null | undefined): string[] {
  return Array.from(new Set(((raw ?? "").match(/<[^<>\s]+>/g) ?? []).map((x) => x.trim())));
}

/** Message-ID canonique (avec chevrons) pour comparer des références. */
export function canonicalMessageId(id: string | null | undefined): string | null {
  const t = (id ?? "").trim();
  if (!t) return null;
  return t.startsWith("<") ? t : `<${t}>`;
}

function formatQuoteDate(iso: string | null, timezone: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  try {
    const date = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(d);
    return `${date} at ${time}`;
  } catch {
    return d.toUTCString();
  }
}

/**
 * Citation du message précédent façon Gmail : "On <date>, <expéditeur> wrote:"
 * puis lignes "> " en texte, `<blockquote class="gmail_quote">` en HTML.
 */
export function buildQuoted(input: {
  body: string;
  sentAt: string | null;
  senderName: string | null;
  senderEmail: string;
  timezone: string;
}): { plain: string; html: string } {
  const date = formatQuoteDate(input.sentAt, input.timezone);
  const who = input.senderName?.trim() ? `${input.senderName.trim()} <${input.senderEmail}>` : input.senderEmail;
  const header = date ? `On ${date}, ${who} wrote:` : `${who} wrote:`;
  const body = input.body.replace(/\r\n/g, "\n").trimEnd();
  const plain = `${header}\n${body
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n")}`;
  const html =
    `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(header)}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">` +
    `${escapeHtml(body).replace(/\n/g, "<br>")}</blockquote></div>`;
  return { plain, html };
}
