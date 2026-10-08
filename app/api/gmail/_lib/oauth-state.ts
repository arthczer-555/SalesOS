// `state` OAuth Google signé (HMAC-SHA256) : protège le callback contre le
// CSRF (un code Google d'un autre compte rattaché à la session d'un rep) et
// transporte le but de la connexion (principale ou boîte d'envoi dédiée).
// Format : base64url(JSON {c, p, t, n}) + "." + base64url(HMAC).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type OAuthPurpose = "main" | "sender";

const MAX_AGE_MS = 30 * 60_000;

function secret(): string | null {
  return process.env.CRON_SECRET || process.env.ENCRYPTION_SECRET || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** null si aucun secret n'est configuré (le flux principal retombe sur l'ancien state). */
export function signOAuthState(clerkUserId: string, purpose: OAuthPurpose): string | null {
  const key = secret();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ c: clerkUserId, p: purpose, t: Date.now(), n: randomBytes(8).toString("hex") }),
  ).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export type ParsedOAuthState =
  | { kind: "signed"; clerkUserId: string; purpose: OAuthPurpose }
  | { kind: "legacy"; clerkUserId: string }
  | { kind: "invalid"; reason: string };

export function parseOAuthState(raw: string | null): ParsedOAuthState {
  if (!raw) return { kind: "invalid", reason: "missing" };
  const dot = raw.indexOf(".");
  // Ancien format (state = clerk user id brut) : connexions démarrées avant le
  // déploiement. Le callback exige alors que la session Clerk corresponde.
  if (dot < 0) return { kind: "legacy", clerkUserId: raw };
  const key = secret();
  if (!key) return { kind: "invalid", reason: "no_secret" };
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(payload, key);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { kind: "invalid", reason: "bad_signature" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { c?: unknown; p?: unknown; t?: unknown };
    if (typeof data.c !== "string" || !data.c) return { kind: "invalid", reason: "bad_payload" };
    if (typeof data.t !== "number" || Date.now() - data.t > MAX_AGE_MS) return { kind: "invalid", reason: "expired" };
    return { kind: "signed", clerkUserId: data.c, purpose: data.p === "sender" ? "sender" : "main" };
  } catch {
    return { kind: "invalid", reason: "bad_payload" };
  }
}
