// Boîte d'envoi Prospecting (1 par user) et santé d'envoi. Le mode d'envoi
// global (off / allowlist / live) est un garde-fou d'environnement.
import { db } from "@/lib/db";
import { localDayStartUtc } from "../schedule";
import type { MailboxHealth, MailboxProvider, MailboxRow } from "../types";
import { normEmail, nowIso } from "./util";

export type SendMode = "off" | "allowlist" | "live";

/** PROSPECTING_SEND_MODE : off par défaut, partout. `live` doit être explicite. */
export function getSendMode(): SendMode {
  const v = (process.env.PROSPECTING_SEND_MODE ?? "").trim().toLowerCase();
  return v === "live" || v === "allowlist" ? v : "off";
}

/** En mode allowlist, seuls ces emails / domaines (@domaine) peuvent recevoir. */
export function isAllowedRecipient(email: string): boolean {
  const mode = getSendMode();
  if (mode === "live") return true;
  if (mode === "off") return false;
  const e = normEmail(email);
  if (!e) return false;
  const list = (process.env.PROSPECTING_SEND_ALLOWLIST ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x));
}

export async function getMailbox(userId: string): Promise<MailboxRow | null> {
  const { data } = await db.from("prospecting_mailboxes").select("*").eq("user_id", userId).maybeSingle();
  return (data as MailboxRow | null) ?? null;
}

export async function getOrCreateMailbox(userId: string): Promise<MailboxRow> {
  const existing = await getMailbox(userId);
  if (existing) return existing;
  const { data: user } = await db.from("users").select("name, email").eq("id", userId).maybeSingle();
  const { data: sender } = await db
    .from("user_integrations")
    .select("connected")
    .eq("user_id", userId)
    .eq("provider", "gmail_sender")
    .maybeSingle();
  const provider: MailboxProvider = sender?.connected ? "gmail_sender" : "gmail";
  const { data, error } = await db
    .from("prospecting_mailboxes")
    .upsert(
      {
        user_id: userId,
        provider,
        email_address: provider === "gmail" ? (user?.email as string | null) ?? null : null,
        from_name: (user?.name as string | null) ?? null,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MailboxRow | null) ?? ((await getMailbox(userId)) as MailboxRow);
}

export async function updateMailbox(userId: string, patch: Partial<Pick<MailboxRow, "from_name" | "timezone" | "daily_limit" | "status" | "paused_reason" | "paused_until" | "provider" | "email_address">>): Promise<MailboxRow> {
  await getOrCreateMailbox(userId);
  const { data, error } = await db
    .from("prospecting_mailboxes")
    .update({ ...patch, updated_at: nowIso() })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MailboxRow;
}

export async function getMailboxHealth(userId: string): Promise<MailboxHealth> {
  const mailbox = await getOrCreateMailbox(userId);
  const { data: integrations } = await db.from("user_integrations").select("provider, connected").eq("user_id", userId);
  const gmailConnected = !!(integrations ?? []).find((i) => i.provider === "gmail" && i.connected);
  const senderConnected = !!(integrations ?? []).find((i) => i.provider === "gmail_sender" && i.connected);

  const dayStart = localDayStartUtc(new Date(), mailbox.timezone).toISOString();
  const { count: sentToday } = await db
    .from("prospecting_touches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("sent_at", dayStart);

  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ count: sent7 }, { count: bounces7 }] = await Promise.all([
    db.from("prospecting_touches").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "sent").gte("sent_at", since7),
    db
      .from("prospecting_replies")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "bounce")
      .eq("category", "bounce_hard")
      .gte("received_at", since7),
  ]);
  const bounceRate7d = sent7 && sent7 > 0 ? (bounces7 ?? 0) / sent7 : null;

  return {
    mailbox,
    gmailConnected,
    senderConnected,
    sentToday: sentToday ?? 0,
    bounceRate7d,
    sendMode: getSendMode(),
  };
}
