import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

/**
 * Helpers de persistance pour la mémoire conversationnelle CoachelloAI
 * dans Slack. Une "thread" = un thread Slack (mentions canal) OU toute la
 * DM (cas IM, thread_ts = "").
 */

export type SlackThreadKey = {
  channel: string;
  threadTs: string; // "" si DM sans thread
};

export async function loadThreadMessages(key: SlackThreadKey): Promise<Anthropic.MessageParam[]> {
  const { data } = await db
    .from("slack_chat_threads")
    .select("messages")
    .eq("slack_channel_id", key.channel)
    .eq("slack_thread_ts", key.threadTs)
    .single();
  return (data?.messages ?? []) as Anthropic.MessageParam[];
}

/**
 * Vérifie si un thread est déjà tracké par CoachelloAI. Utilisé par le
 * handler `message.channels` pour ne répondre QUE dans les threads où le
 * bot a déjà été invoqué (sinon il répondrait à tous les messages des
 * canaux où il est membre).
 */
export async function isThreadTracked(key: SlackThreadKey): Promise<boolean> {
  if (!key.threadTs) return false;
  const { data } = await db
    .from("slack_chat_threads")
    .select("id")
    .eq("slack_channel_id", key.channel)
    .eq("slack_thread_ts", key.threadTs)
    .single();
  return !!data;
}

export async function saveThreadMessages(args: {
  key: SlackThreadKey;
  userId: string;
  teamId?: string | null;
  messages: Anthropic.MessageParam[];
}): Promise<void> {
  await db
    .from("slack_chat_threads")
    .upsert(
      {
        slack_channel_id: args.key.channel,
        slack_thread_ts: args.key.threadTs,
        slack_team_id: args.teamId ?? null,
        user_id: args.userId,
        messages: args.messages,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slack_channel_id,slack_thread_ts" },
    );
}
