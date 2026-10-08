import { db } from "./db";
import { decrypt } from "./crypto";
import {
  escapeHtml,
  normalizeSignature,
  renderSignatureHtml,
  renderSignaturePlain,
} from "./email/signature";

/** Connexion Google absente, révoquée ou expirée (à distinguer d'une erreur réseau). */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/**
 * provider : "gmail" = connexion Google principale ; "gmail_sender" = boîte
 * dédiée à la prospection (domaine secondaire), cf. Prospecting > Settings.
 */
export async function getGmailAccessToken(userId: string, provider: "gmail" | "gmail_sender" = "gmail"): Promise<string> {
  const { data } = await db
    .from("user_integrations")
    .select("access_token, token_expiry, encrypted_refresh, refresh_iv, refresh_auth_tag, connected")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (!data?.connected) throw new GmailAuthError("Google not connected. Go to Settings → Connect Google to enable analytics.");

  // Still valid (5 min buffer)
  if (new Date(data.token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
    return data.access_token;
  }

  // Refresh
  const refreshToken = decrypt({
    encryptedKey: data.encrypted_refresh,
    iv: data.refresh_iv,
    authTag: data.refresh_auth_tag,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new GmailAuthError("Google token expired. Go to Settings → Disconnect Google → Reconnect.");

  const { access_token, expires_in } = await res.json();
  const tokenExpiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  await db
    .from("user_integrations")
    .update({ access_token, token_expiry: tokenExpiry })
    .eq("user_id", userId)
    .eq("provider", provider);

  return access_token;
}

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

function findHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractBody(p);
      if (t) return t;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64")
      .toString("utf-8")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
};

export async function searchGmailMessages(
  userId: string,
  query: string,
  maxResults = 10,
): Promise<GmailMessageSummary[]> {
  const token = await getGmailAccessToken(userId);
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) throw new Error(`Gmail API ${listRes.status}`);
  const listData = (await listRes.json()) as { messages?: { id: string; threadId: string }[] };
  const ids = listData.messages ?? [];

  const details = await Promise.all(
    ids.map(async (m) => {
      const metaUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
      const mRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!mRes.ok) return null;
      const md = (await mRes.json()) as { snippet?: string; payload?: { headers?: GmailHeader[] } };
      const headers = md.payload?.headers ?? [];
      return {
        id: m.id,
        threadId: m.threadId,
        from: findHeader(headers, "From"),
        to: findHeader(headers, "To"),
        subject: findHeader(headers, "Subject"),
        date: findHeader(headers, "Date"),
        snippet: md.snippet ?? "",
      } satisfies GmailMessageSummary;
    }),
  );
  return details.filter((d): d is GmailMessageSummary => d !== null);
}

export type GmailMessageFull = GmailMessageSummary & { cc: string; body: string };

export async function getGmailMessage(userId: string, messageId: string): Promise<GmailMessageFull> {
  const token = await getGmailAccessToken(userId);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  const data = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    payload?: GmailPart & { headers?: GmailHeader[] };
  };
  const headers = data.payload?.headers ?? [];
  return {
    id: data.id,
    threadId: data.threadId,
    from: findHeader(headers, "From"),
    to: findHeader(headers, "To"),
    cc: findHeader(headers, "Cc"),
    subject: findHeader(headers, "Subject"),
    date: findHeader(headers, "Date"),
    snippet: data.snippet ?? "",
    body: extractBody(data.payload),
  };
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

export type SignatureImage = { data: Buffer; mime: string; cid: string };

/**
 * Charge la signature d'un utilisateur et la rend (HTML + texte) prête pour l'envoi.
 * Si une image est présente, elle est décodée (bytes) et le HTML référence `cid:...`
 * pour l'embarquer inline. Retourne null si aucune signature configurée/activée.
 */
export async function loadUserSignature(
  userId: string,
): Promise<{ html: string; plain: string; image?: SignatureImage } | null> {
  const { data } = await db
    .from("users")
    .select("email_signature")
    .eq("id", userId)
    .single();

  if (!data?.email_signature) return null;
  const sig = normalizeSignature(data.email_signature);
  if (!sig.enabled) return null;

  let image: SignatureImage | undefined;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(sig.image);
  if (m) {
    const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    if (buf.length > 0) image = { data: buf, mime: m[1], cid: "signature-image" };
  }

  const html = renderSignatureHtml(sig, { imageSrc: image ? `cid:${image.cid}` : undefined });
  const plain = renderSignaturePlain(sig);
  if (!html && !plain) return null;
  return { html, plain, image };
}

export function buildRawEmail({
  from,
  fromName,
  to,
  cc,
  bcc,
  subject,
  body,
  attachments = [],
  signature,
  inReplyTo,
  references,
  quoted,
}: {
  from: string;
  /** Nom affiché de l'expéditeur ("Gaspard Dupont" <from>). */
  fromName?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments?: { name: string; type: string; data: Buffer }[];
  signature?: { html: string; plain: string; image?: SignatureImage };
  /** Threading RFC 5322 : Message-ID du message auquel on répond. */
  inReplyTo?: string | null;
  /** Threading : Message-IDs de toute la chaîne. */
  references?: string[];
  /** Message précédent cité sous le corps (relances en thread). */
  quoted?: { html: string; plain: string } | null;
}): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const fromHeader = fromName?.trim()
    ? `=?UTF-8?B?${Buffer.from(fromName.trim()).toString("base64")}?= <${from}>`
    : from;
  const angle = (id: string) => (id.startsWith("<") ? id : `<${id}>`);
  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodedSubject}`,
    ...(inReplyTo ? [`In-Reply-To: ${angle(inReplyTo)}`] : []),
    ...(references && references.length ? [`References: ${references.map(angle).join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];

  // Si une signature riche est fournie, on passe l'email en multipart/alternative
  // (texte + HTML) pour que la signature s'affiche mise en forme. Sinon on reste
  // en text/plain comme avant (rétrocompatible).
  const withHtml = Boolean(signature && signature.html);
  const basePlain = signature?.plain ? `${body}\n\n${signature.plain}` : body;
  const plainBody = quoted?.plain ? `${basePlain}\n\n${quoted.plain}` : basePlain;

  // Content-Type + contenu du "corps" (avant les éventuelles pièces jointes).
  let contentType: string;
  let contentBlock: string;
  if (withHtml) {
    const htmlBody =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">` +
      `${textToHtml(body)}</div>${signature!.html}${quoted?.html ?? ""}`;
    const altBoundary = `__alt_${Date.now()}__`;
    const altBlock = [
      `--${altBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      plainBody,
      `--${altBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      htmlBody,
      `--${altBoundary}--`,
    ].join("\r\n");
    const altType = `multipart/alternative; boundary="${altBoundary}"`;

    const img = signature!.image;
    if (img) {
      // Image inline (CID) : multipart/related { alternative, image }.
      const imgB64 = img.data.toString("base64").replace(/.{76}/g, "$&\r\n");
      const relBoundary = `__rel_${Date.now()}__`;
      contentType = `multipart/related; boundary="${relBoundary}"`;
      contentBlock = [
        `--${relBoundary}`,
        `Content-Type: ${altType}`,
        "",
        altBlock,
        `--${relBoundary}`,
        `Content-Type: ${img.mime}`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${img.cid}>`,
        'Content-Disposition: inline; filename="signature"',
        "",
        imgB64,
        `--${relBoundary}--`,
      ].join("\r\n");
    } else {
      contentType = altType;
      contentBlock = altBlock;
    }
  } else {
    contentType = "text/plain; charset=UTF-8";
    contentBlock = plainBody;
  }

  if (attachments.length === 0) {
    const msg = [...headers, `Content-Type: ${contentType}`, "", contentBlock].join("\r\n");
    return Buffer.from(msg).toString("base64url");
  }

  const boundary = `__boundary_${Date.now()}__`;
  const parts: string[] = [
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    "",
    contentBlock,
  ];

  for (const att of attachments) {
    const b64 = att.data.toString("base64").replace(/.{76}/g, "$&\r\n");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.type || "application/octet-stream"}; name="${att.name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.name}"`,
      "",
      b64,
    );
  }
  parts.push(`--${boundary}--`);

  const msg = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    parts.join("\r\n"),
  ].join("\r\n");

  return Buffer.from(msg).toString("base64url");
}

// ── API bas niveau pour Prospecting (envoi threadé, synchro des réponses) ────

export type GmailProvider = "gmail" | "gmail_sender";

export type GmailSendErrorKind = "auth" | "quota" | "invalid_recipient" | "transient";

/** Erreur d'envoi typée : le moteur de séquences décide pause / retry / échec. */
export class GmailSendError extends Error {
  constructor(
    message: string,
    public readonly kind: GmailSendErrorKind,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

/** History Gmail expirée (startHistoryId trop ancien) : resynchro par threads. */
export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history expired");
    this.name = "GmailHistoryExpiredError";
  }
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailApi(
  userId: string,
  path: string,
  init: RequestInit = {},
  provider: GmailProvider = "gmail",
): Promise<Response> {
  const token = await getGmailAccessToken(userId, provider);
  return fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

function classifySendError(status: number, reason: string, message: string): GmailSendErrorKind {
  const r = `${reason} ${message}`.toLowerCase();
  if (status === 401 || r.includes("invalid_grant") || r.includes("insufficient") || r.includes("unauthorized")) return "auth";
  if (status === 429 || r.includes("ratelimit") || r.includes("dailylimit") || r.includes("quota")) return "quota";
  if (status === 403 && (r.includes("limit") || r.includes("exceeded"))) return "quota";
  if (status === 403) return "auth";
  if (status === 400 && (r.includes("recipient") || r.includes("invalid to") || r.includes("address"))) return "invalid_recipient";
  return "transient";
}

/** Envoie un message RFC 2822 encodé (base64url). threadId = relance dans le thread. */
export async function sendGmailRaw(
  userId: string,
  payload: { raw: string; threadId?: string | null },
  provider: GmailProvider = "gmail",
): Promise<{ id: string; threadId: string }> {
  let res: Response;
  try {
    res = await gmailApi(
      userId,
      "/messages/send",
      { method: "POST", body: JSON.stringify(payload.threadId ? { raw: payload.raw, threadId: payload.threadId } : { raw: payload.raw }) },
      provider,
    );
  } catch (e) {
    if (e instanceof GmailAuthError) throw new GmailSendError(e.message, "auth", 401);
    throw new GmailSendError(e instanceof Error ? e.message : "Network error", "transient", 0);
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const message = json.error?.message ?? `Gmail send HTTP ${res.status}`;
    const reason = json.error?.errors?.[0]?.reason ?? "";
    throw new GmailSendError(message, classifySendError(res.status, reason, message), res.status);
  }
  const data = (await res.json()) as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}

export async function getGmailProfile(
  userId: string,
  provider: GmailProvider = "gmail",
): Promise<{ emailAddress: string; historyId: string }> {
  const res = await gmailApi(userId, "/profile", {}, provider);
  if (!res.ok) throw new Error(`Gmail profile HTTP ${res.status}`);
  const data = (await res.json()) as { emailAddress: string; historyId: string };
  return { emailAddress: data.emailAddress, historyId: String(data.historyId) };
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: string | null;
  snippet: string;
  headers: Record<string, string>;
}

/** Métadonnées d'un message (en-têtes demandés, en minuscules). */
export async function getMessageHeaders(
  userId: string,
  messageId: string,
  names: string[],
  provider: GmailProvider = "gmail",
): Promise<GmailMessageMeta> {
  const qs = names.map((n) => `metadataHeaders=${encodeURIComponent(n)}`).join("&");
  const res = await gmailApi(userId, `/messages/${messageId}?format=metadata&${qs}`, {}, provider);
  if (!res.ok) throw new Error(`Gmail message HTTP ${res.status}`);
  const data = (await res.json()) as {
    id: string;
    threadId: string;
    labelIds?: string[];
    internalDate?: string;
    snippet?: string;
    payload?: { headers?: GmailHeader[] };
  };
  const headers: Record<string, string> = {};
  for (const h of data.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  return {
    id: data.id,
    threadId: data.threadId,
    labelIds: data.labelIds ?? [],
    internalDate: data.internalDate ?? null,
    snippet: data.snippet ?? "",
    headers,
  };
}

/** Message complet (corps texte) via le provider voulu. */
export async function getGmailMessageFull(
  userId: string,
  messageId: string,
  provider: GmailProvider = "gmail",
): Promise<GmailMessageFull & { labelIds: string[]; internalDate: string | null; headers: Record<string, string> }> {
  const res = await gmailApi(userId, `/messages/${messageId}?format=full`, {}, provider);
  if (!res.ok) throw new Error(`Gmail message HTTP ${res.status}`);
  const data = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    internalDate?: string;
    payload?: GmailPart & { headers?: GmailHeader[] };
  };
  const list = data.payload?.headers ?? [];
  const headers: Record<string, string> = {};
  for (const h of list) headers[h.name.toLowerCase()] = h.value;
  return {
    id: data.id,
    threadId: data.threadId,
    from: findHeader(list, "From"),
    to: findHeader(list, "To"),
    cc: findHeader(list, "Cc"),
    subject: findHeader(list, "Subject"),
    date: findHeader(list, "Date"),
    snippet: data.snippet ?? "",
    body: extractBody(data.payload),
    labelIds: data.labelIds ?? [],
    internalDate: data.internalDate ?? null,
    headers,
  };
}

export interface GmailHistoryPage {
  messages: { id: string; threadId: string; labelIds: string[] }[];
  nextPageToken: string | null;
  historyId: string | null;
}

/** Messages ajoutés depuis startHistoryId. Lève GmailHistoryExpiredError sur 404. */
export async function listGmailHistory(
  userId: string,
  startHistoryId: string,
  pageToken: string | null = null,
  provider: GmailProvider = "gmail",
): Promise<GmailHistoryPage> {
  const qs = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
  if (pageToken) qs.set("pageToken", pageToken);
  const res = await gmailApi(userId, `/history?${qs.toString()}`, {}, provider);
  if (res.status === 404) throw new GmailHistoryExpiredError();
  if (!res.ok) throw new Error(`Gmail history HTTP ${res.status}`);
  const data = (await res.json()) as {
    history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
    nextPageToken?: string;
    historyId?: string;
  };
  const messages: GmailHistoryPage["messages"] = [];
  for (const h of data.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      messages.push({ id: m.message.id, threadId: m.message.threadId, labelIds: m.message.labelIds ?? [] });
    }
  }
  return { messages, nextPageToken: data.nextPageToken ?? null, historyId: data.historyId ? String(data.historyId) : null };
}

/** Liste brute d'ids de messages pour une requête Gmail (q=...). */
export async function listGmailMessageIds(
  userId: string,
  query: string,
  maxResults = 50,
  provider: GmailProvider = "gmail",
): Promise<{ id: string; threadId: string }[]> {
  const res = await gmailApi(userId, `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, {}, provider);
  if (!res.ok) throw new Error(`Gmail list HTTP ${res.status}`);
  const data = (await res.json()) as { messages?: { id: string; threadId: string }[] };
  return data.messages ?? [];
}

/** Messages d'un thread (métadonnées). */
export async function getGmailThread(
  userId: string,
  threadId: string,
  provider: GmailProvider = "gmail",
): Promise<{ id: string; messages: GmailMessageMeta[] }> {
  const names = ["From", "To", "Subject", "Message-ID", "In-Reply-To", "References", "Date", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence", "X-Failed-Recipients", "Content-Type"];
  const qs = names.map((n) => `metadataHeaders=${encodeURIComponent(n)}`).join("&");
  const res = await gmailApi(userId, `/threads/${threadId}?format=metadata&${qs}`, {}, provider);
  if (!res.ok) throw new Error(`Gmail thread HTTP ${res.status}`);
  const data = (await res.json()) as {
    id: string;
    messages?: { id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: { headers?: GmailHeader[] } }[];
  };
  return {
    id: data.id,
    messages: (data.messages ?? []).map((m) => {
      const headers: Record<string, string> = {};
      for (const h of m.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
      return { id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? [], internalDate: m.internalDate ?? null, snippet: m.snippet ?? "", headers };
    }),
  };
}
