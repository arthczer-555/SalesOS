import { db } from "./db";
import { decrypt } from "./crypto";

export async function getGmailAccessToken(userId: string): Promise<string> {
  const { data } = await db
    .from("user_integrations")
    .select("access_token, token_expiry, encrypted_refresh, refresh_iv, refresh_auth_tag, connected")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .single();

  if (!data?.connected) throw new Error("Gmail non connecté");

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

  if (!res.ok) throw new Error("Échec du refresh token Gmail");

  const { access_token, expires_in } = await res.json();
  const tokenExpiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  await db
    .from("user_integrations")
    .update({ access_token, token_expiry: tokenExpiry })
    .eq("user_id", userId)
    .eq("provider", "gmail");

  return access_token;
}

export function buildRawEmail({
  from,
  to,
  cc,
  bcc,
  subject,
  body,
  attachments = [],
}: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments?: { name: string; type: string; data: Buffer }[];
}): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
  ];

  if (attachments.length === 0) {
    const msg = [...headers, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
    return Buffer.from(msg).toString("base64url");
  }

  const boundary = `__boundary_${Date.now()}__`;
  const parts: string[] = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
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
