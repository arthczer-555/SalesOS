// Envoi des messages du bot dans la conversation d'une annonce (fil de
// l'annonce dans #1y, ou DM de test).

import { postMessage, updateMessage } from "@/lib/slack/api";
import { slackBotGet } from "@/lib/slack/search";
import type { AnnouncementRow } from "./types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Remplace le texte du message du bot (proposition ou issue). */
export async function updateBotMessage(row: AnnouncementRow, text: string): Promise<string | null> {
  if (!row.bot_message_ts) return "no bot message to update";
  try {
    await updateMessage({ channel: row.thread_channel, ts: row.bot_message_ts, text });
    return null;
  } catch (e) {
    return errMsg(e);
  }
}

/** Réponse courte dans le fil de la conversation. */
export async function replyInThread(row: AnnouncementRow, text: string): Promise<string | null> {
  if (!row.thread_ts || row.thread_ts.startsWith("pending:")) return "no thread yet";
  try {
    await postMessage({ channel: row.thread_channel, thread_ts: row.thread_ts, text });
    return null;
  } catch (e) {
    return errMsg(e);
  }
}

export async function permalinkOf(channel: string, ts: string): Promise<string | null> {
  const res = await slackBotGet<{ permalink?: string }>("/chat.getPermalink", { channel, message_ts: ts });
  return res.ok ? res.permalink ?? null : null;
}

/** Message du bot déjà posté dans ce fil (un essai précédent a pu poster puis planter). */
export async function botReplyInThread(channel: string, threadTs: string, botUserId: string | null): Promise<string | null> {
  if (!botUserId) return null;
  const res = await slackBotGet<{ messages?: { ts: string; user?: string; bot_id?: string; thread_ts?: string }[] }>("/conversations.replies", { channel, ts: threadTs, limit: "50" });
  if (!res.ok) return null;
  const mine = (res.messages ?? []).find((m) => m.ts !== threadTs && m.user === botUserId);
  return mine?.ts ?? null;
}

let botUserIdCache: string | null = null;

/** Identifiant Slack du bot (auth.test), en cache. */
export async function botUserId(): Promise<string | null> {
  if (botUserIdCache) return botUserIdCache;
  if (process.env.SLACK_BOT_USER_ID) return (botUserIdCache = process.env.SLACK_BOT_USER_ID);
  const res = await slackBotGet<{ user_id?: string }>("/auth.test");
  botUserIdCache = res.ok ? res.user_id ?? null : null;
  return botUserIdCache;
}

/** Ouvre (ou retrouve) le DM du bot avec une personne. */
export async function openDmChannel(slackUserId: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ users: slackUserId }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { ok: boolean; channel?: { id: string } };
    return data.ok ? data.channel?.id ?? null : null;
  } catch {
    return null;
  }
}
