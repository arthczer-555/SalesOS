// Réception des événements Slack du flux #1y-new-meetings (appelée par
// app/api/slack/events/route.ts, qui doit répondre à Slack en moins de 3 s).
// Ici : tri bon marché, enregistrement (idempotent face aux rejeux Slack),
// puis envoi au traitement de fond. Renvoie true si l'événement concerne le
// flux (il ne part alors pas chez CoachelloAI).

import { db } from "@/lib/db";
import { parseConfirmationAnswer } from "@/lib/slack/confirmations";
import { MEETINGS_CHANNEL_ID, flowMode, stripTestPrefix, testUserSlackId } from "./config";
import { announcementFiles, announcementText, contentHash, forwardedFromChannel, type IncomingSlackMessage, type SlackAttachment } from "./message";
import { botUserId, openDmChannel, permalinkOf } from "./slack-io";
import { enqueueEvent, findByBotMessage, findByMessage, findByThread, insertAnnouncement, type AnnouncementEventKind } from "./store";
import type { SlackFileRef } from "./types";

export interface MeetingSlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  event_ts?: string;
  thread_ts?: string;
  text?: string;
  bot_id?: string;
  files?: SlackFileRef[];
  attachments?: SlackAttachment[];
  message?: IncomingSlackMessage;
  deleted_ts?: string;
  reaction?: string;
  item?: { type?: string; channel?: string; ts?: string };
  item_user?: string;
}

export type Dispatch = (announcementId: string) => Promise<void>;

async function userIdOfSlack(slackId: string | undefined): Promise<string | null> {
  if (!slackId) return null;
  const { data } = await db.from("users").select("id").eq("slack_user_id", slackId).limit(1);
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

async function queue(eventId: string, announcementId: string, kind: AnnouncementEventKind, slackTs: string | null, user: string | null, payload: Record<string, unknown>, dispatch: Dispatch): Promise<true> {
  await enqueueEvent({ eventId, announcementId, kind, slackTs, slackUserId: user, payload });
  // Rejeu Slack : l'événement est déjà en file, relancer le traitement ne coûte rien (bail exclusif).
  await dispatch(announcementId);
  return true;
}

export async function ingestMeetingEvent(eventIdRaw: string | undefined, ev: MeetingSlackEvent, dispatch: Dispatch): Promise<boolean> {
  const eventId = eventIdRaw || `${ev.type}:${ev.channel ?? ev.item?.channel}:${ev.event_ts ?? ev.ts ?? ev.item?.ts}:${ev.user ?? ""}:${ev.reaction ?? ""}`;

  // ── Réaction ✅ / ❌ sur le message du bot ──────────────────────────────
  if (ev.type === "reaction_added") {
    const answer = parseConfirmationAnswer(ev.reaction);
    if (!answer || !ev.item?.channel || !ev.item.ts || !ev.user) return false;
    // Réaction sur un message qui n'est pas du bot (ex. ✅ de félicitations sur l'annonce) : rien.
    const bot = await botUserId();
    if (!bot || ev.item_user !== bot) return false;
    const row = await findByBotMessage(ev.item.channel, ev.item.ts);
    if (!row) return false;
    return queue(eventId, row.id, "reaction", ev.event_ts ?? ev.item.ts, ev.user, { answer }, dispatch);
  }

  // Mention du bot dans #1y : jamais de réponse CoachelloAI dans ce canal.
  if (ev.type === "app_mention") return ev.channel === MEETINGS_CHANNEL_ID;
  if (ev.type !== "message" || !ev.channel) return false;

  const inChannel = ev.channel === MEETINGS_CHANNEL_ID;
  const inDm = ev.channel_type === "im";
  if (!inChannel && !inDm) return false;

  // ── Modification / suppression de l'annonce ────────────────────────────
  if (ev.subtype === "message_changed") {
    const msg = ev.message;
    if (!msg?.ts || msg.bot_id) return inChannel;
    const row = await findByMessage(ev.channel, msg.ts);
    if (!row) return inChannel;
    return queue(eventId, row.id, "edited", ev.event_ts ?? ev.ts ?? null, msg.user ?? null, { message: msg as unknown as Record<string, unknown> }, dispatch);
  }
  if (ev.subtype === "message_deleted") {
    if (!ev.deleted_ts) return inChannel;
    const row = await findByMessage(ev.channel, ev.deleted_ts);
    if (!row) return inChannel;
    return queue(eventId, row.id, "deleted", ev.event_ts ?? ev.ts ?? null, null, {}, dispatch);
  }
  if (ev.bot_id || ev.subtype === "bot_message") return inChannel;
  if (ev.subtype && ev.subtype !== "file_share" && ev.subtype !== "thread_broadcast") return inChannel;
  if (!ev.user || !ev.ts) return inChannel;

  // ── Message dans le fil d'une annonce ──────────────────────────────────
  const isReply = (!!ev.thread_ts && ev.thread_ts !== ev.ts) || ev.subtype === "thread_broadcast";
  if (isReply) {
    if (!ev.thread_ts) return inChannel;
    const row = await findByThread(ev.channel, ev.thread_ts);
    if (!row) return inChannel;
    return queue(eventId, row.id, "thread_message", ev.ts, ev.user, { text: announcementText(ev), files: announcementFiles(ev) }, dispatch);
  }

  // ── Nouvelle annonce ──────────────────────────────────────────────────
  if (inChannel) {
    const mode = await flowMode();
    if (mode === "off") return true;
    const text = announcementText(ev);
    const files = announcementFiles(ev);
    let threadChannel = ev.channel;
    let threadTs = ev.ts;
    if (mode === "test") {
      // Mode test : la vraie annonce est recopiée dans le DM de la personne qui teste, rien n'est posté dans le canal.
      const tester = await testUserSlackId();
      const dm = tester ? await openDmChannel(tester) : null;
      if (!dm) return true;
      threadChannel = dm;
      threadTs = `pending:${ev.ts}`;
    }
    const { row, created } = await insertAnnouncement({
      slack_channel_id: ev.channel,
      slack_ts: ev.ts,
      slack_permalink: await permalinkOf(ev.channel, ev.ts),
      source_kind: mode === "test" ? "mirror" : "channel",
      posted_by_slack_id: ev.user,
      posted_by_user_id: await userIdOfSlack(ev.user),
      text,
      files,
      text_hash: contentHash(text, files),
      thread_channel: threadChannel,
      thread_ts: threadTs,
      mode: mode === "test" ? "test" : "live",
      status: "received",
    });
    if (created || row.status === "received") await dispatch(row.id);
    return true;
  }

  // DM du bot : seulement une annonce de test ("new meeting ..." ou annonce de #1y
  // transférée), en mode test, de la personne qui teste. Tri sur le texte
  // d'abord : les autres DM (CoachelloAI) ne coûtent aucune lecture en base.
  const { matched, rest } = stripTestPrefix(ev.text ?? "");
  if (!matched && forwardedFromChannel(ev) !== MEETINGS_CHANNEL_ID) return false;
  if ((await flowMode()) !== "test") return false;
  const tester = await testUserSlackId();
  if (!tester || ev.user !== tester) return false;
  const text = announcementText({ ...ev, text: matched ? rest : ev.text });
  const files = announcementFiles(ev);
  const { row, created } = await insertAnnouncement({
    slack_channel_id: ev.channel,
    slack_ts: ev.ts,
    slack_permalink: null,
    source_kind: "dm_test",
    posted_by_slack_id: ev.user,
    posted_by_user_id: await userIdOfSlack(ev.user),
    text,
    files,
    text_hash: contentHash(text, files),
    thread_channel: ev.channel,
    thread_ts: ev.ts,
    mode: "test",
    status: "received",
  });
  if (created || row.status === "received") await dispatch(row.id);
  return true;
}
