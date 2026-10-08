// Transitions d'état de la boîte d'envoi décidées par le moteur (connexion
// Google perdue, quota Gmail atteint) et résolution de l'adresse d'envoi.
import { db } from "@/lib/db";
import { getGmailProfile } from "@/lib/gmail";
import { addSendDays, localDay, windowStartUtc } from "../schedule";
import { DEFAULT_WINDOW } from "../settings";
import { logEvent } from "../store/events";
import { nowIso } from "../store/util";
import type { MailboxRow, SendWindow } from "../types";
import { appUrl } from "./context";
import { notifyRep } from "./notify";

/**
 * Connexion Google révoquée / expirée : boîte `disconnected` (bannière dans
 * l'UI) et DM Slack au rep, une seule fois (seul le passage d'un autre statut
 * à `disconnected` notifie).
 */
export async function markMailboxDisconnected(mailbox: MailboxRow, message: string): Promise<void> {
  const { data } = await db
    .from("prospecting_mailboxes")
    .update({ status: "disconnected", paused_reason: "gmail_auth", sync_error: message, updated_at: nowIso() })
    .eq("id", mailbox.id)
    .neq("status", "disconnected")
    .select("id");
  if (!data?.length) return;
  await logEvent({ type: "paused", userId: mailbox.user_id, data: { scope: "mailbox", reason: "gmail_auth", message } });
  await notifyRep(
    mailbox.user_id,
    `Prospecting is paused: CoachelloHQ can't access your Gmail${mailbox.email_address ? ` (${mailbox.email_address})` : ""} anymore (connection missing, expired or revoked). No email is sent and replies are not checked until you reconnect it: ${appUrl("/prospecting/campaigns")}`,
  );
}

/** Quota Gmail atteint : pause jusqu'à la prochaine ouverture de fenêtre demain. */
export async function pauseMailboxForQuota(mailbox: MailboxRow, window: SendWindow | null, message: string): Promise<string> {
  const w = window ?? { ...DEFAULT_WINDOW, timezone: mailbox.timezone };
  const tomorrow = addSendDays(localDay(new Date(), w.timezone), 1, w);
  const until = windowStartUtc(tomorrow, w).toISOString();
  await db
    .from("prospecting_mailboxes")
    .update({ status: "paused", paused_reason: "gmail_quota", paused_until: until, sync_error: null, updated_at: nowIso() })
    .eq("id", mailbox.id)
    .eq("status", "active");
  await logEvent({ type: "paused", userId: mailbox.user_id, data: { scope: "mailbox", reason: "gmail_quota", until, message } });
  return until;
}

/** Adresse d'envoi de la boîte, lue sur le profil Gmail au besoin puis mémorisée. */
export async function resolveFromEmail(mailbox: MailboxRow): Promise<string> {
  if (mailbox.email_address) return mailbox.email_address;
  const profile = await getGmailProfile(mailbox.user_id, mailbox.provider);
  await db
    .from("prospecting_mailboxes")
    .update({ email_address: profile.emailAddress, updated_at: nowIso() })
    .eq("id", mailbox.id);
  mailbox.email_address = profile.emailAddress;
  return profile.emailAddress;
}

export async function reloadMailbox(mailboxId: string): Promise<MailboxRow | null> {
  const { data } = await db.from("prospecting_mailboxes").select("*").eq("id", mailboxId).maybeSingle();
  return (data as MailboxRow | null) ?? null;
}
