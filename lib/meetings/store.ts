// Accès à la base du flux #1y-new-meetings (tables meeting_announcements et
// meeting_announcement_events, migration supabase/migrations/meeting_announcements.sql).

import { db } from "@/lib/db";
import type { AnnouncementRow, AnnouncementStatus } from "./types";

const TABLE = "meeting_announcements";
const EVENTS = "meeting_announcement_events";

export async function getAnnouncement(id: string): Promise<AnnouncementRow | null> {
  const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`meeting_announcements read failed: ${error.message}`);
  return (data as AnnouncementRow | null) ?? null;
}

export async function findByMessage(channel: string, ts: string): Promise<AnnouncementRow | null> {
  const { data, error } = await db.from(TABLE).select("*").eq("slack_channel_id", channel).eq("slack_ts", ts).maybeSingle();
  if (error) throw new Error(`meeting_announcements read failed: ${error.message}`);
  return (data as AnnouncementRow | null) ?? null;
}

/** Annonce dont la conversation vit dans ce fil (fil de l'annonce, ou fil du DM de test). */
export async function findByThread(channel: string, threadTs: string): Promise<AnnouncementRow | null> {
  const { data, error } = await db.from(TABLE).select("*").eq("thread_channel", channel).eq("thread_ts", threadTs).order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`meeting_announcements read failed: ${error.message}`);
  return ((data ?? [])[0] as AnnouncementRow | undefined) ?? null;
}

export async function findByBotMessage(channel: string, ts: string): Promise<AnnouncementRow | null> {
  const { data, error } = await db.from(TABLE).select("*").eq("thread_channel", channel).eq("bot_message_ts", ts).maybeSingle();
  if (error) throw new Error(`meeting_announcements read failed: ${error.message}`);
  return (data as AnnouncementRow | null) ?? null;
}

/** Insère l'annonce, ou renvoie celle qui existe déjà pour ce message (rejeu Slack). */
export async function insertAnnouncement(row: Partial<AnnouncementRow> & { slack_channel_id: string; slack_ts: string }): Promise<{ row: AnnouncementRow; created: boolean }> {
  const { data, error } = await db.from(TABLE).insert(row).select("*").single();
  if (!error) return { row: data as AnnouncementRow, created: true };
  if (error.code === "23505") {
    const existing = await findByMessage(row.slack_channel_id, row.slack_ts);
    if (existing) return { row: existing, created: false };
  }
  throw new Error(`meeting_announcements insert failed: ${error.message}`);
}

export async function patchAnnouncement(id: string, patch: Partial<AnnouncementRow>): Promise<void> {
  const { error } = await db.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`meeting_announcements update failed: ${error.message}`);
}

/** Passage d'état conditionnel : renvoie la ligne si elle était dans un des états `from`. */
export async function transitionStatus(
  id: string,
  from: readonly AnnouncementStatus[],
  to: AnnouncementStatus,
  patch: Partial<AnnouncementRow> = {},
): Promise<AnnouncementRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from as AnnouncementStatus[])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`meeting_announcements transition failed: ${error.message}`);
  return (data as AnnouncementRow | null) ?? null;
}

/**
 * Bail exclusif sur une annonce (une seule exécution de fond à la fois) :
 * mise à jour conditionnelle, la ligne n'est rendue que si le bail était libre
 * ou expiré.
 */
export async function acquireLease(id: string, ms = 180_000): Promise<AnnouncementRow | null> {
  const now = new Date();
  const { data, error } = await db
    .from(TABLE)
    .update({ lease_until: new Date(now.getTime() + ms).toISOString(), updated_at: now.toISOString() })
    .eq("id", id)
    .or(`lease_until.is.null,lease_until.lt."${now.toISOString()}"`)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`meeting_announcements lease failed: ${error.message}`);
  return (data as AnnouncementRow | null) ?? null;
}

export async function releaseLease(id: string): Promise<void> {
  await db.from(TABLE).update({ lease_until: null }).eq("id", id);
}

// ── File des événements Slack d'une annonce ─────────────────────────────────

export type AnnouncementEventKind = "reaction" | "thread_message" | "edited" | "deleted";

export interface AnnouncementEvent {
  event_id: string;
  announcement_id: string;
  created_at: string;
  kind: AnnouncementEventKind;
  slack_ts: string | null;
  slack_user_id: string | null;
  payload: Record<string, unknown> | null;
  processed_at: string | null;
  result: string | null;
}

/** Ajoute un événement à la file. false si déjà là (rejeu Slack). */
export async function enqueueEvent(e: {
  eventId: string;
  announcementId: string;
  kind: AnnouncementEventKind;
  slackTs: string | null;
  slackUserId: string | null;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const { error } = await db.from(EVENTS).insert({
    event_id: e.eventId,
    announcement_id: e.announcementId,
    kind: e.kind,
    slack_ts: e.slackTs,
    slack_user_id: e.slackUserId,
    payload: e.payload,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`meeting_announcement_events insert failed: ${error.message}`);
}

export async function pendingEvents(announcementId: string): Promise<AnnouncementEvent[]> {
  const { data, error } = await db.from(EVENTS).select("*").eq("announcement_id", announcementId).is("processed_at", null).order("slack_ts", { ascending: true }).limit(50);
  if (error) throw new Error(`meeting_announcement_events read failed: ${error.message}`);
  return (data ?? []) as AnnouncementEvent[];
}

export async function markEventProcessed(eventId: string, result: string): Promise<void> {
  await db.from(EVENTS).update({ processed_at: new Date().toISOString(), result: result.slice(0, 500) }).eq("event_id", eventId);
}
