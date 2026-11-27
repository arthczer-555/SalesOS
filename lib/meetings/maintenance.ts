// Tâches planifiées du flux #1y-new-meetings (toutes les 15 min, fonction
// meeting-announcements-scheduled) : relance de ce qui est bloqué, rappel à
// 24 h, expiration. Appelé directement (pas par une route : deux crons sont
// déjà morts sur le middleware).

import { db } from "@/lib/db";
import { dmRecipient } from "@/lib/slack/lookup";
import { EXPIRY_AFTER_MEETING_MS, EXPIRY_AFTER_POST_MS, REMINDER_AFTER_MS, testUserSlackId } from "./config";
import { missingText, renderOutcome } from "./proposal";
import { patchAnnouncement, transitionStatus } from "./store";
import { permalinkOf, replyInThread, updateBotMessage } from "./slack-io";
import { OPEN_STATUSES, type AnnouncementRow } from "./types";

const MAX_ANALYSIS_ATTEMPTS = 3;

function parisBusinessHours(now = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return parts.weekday !== "Sat" && parts.weekday !== "Sun" && hour >= 9 && hour < 18;
}

export async function runMaintenance(dispatch: (id: string) => Promise<void>, now = new Date()): Promise<{ redispatched: number; reminded: number; expired: number; gaveUp: number }> {
  const out = { redispatched: 0, reminded: 0, expired: 0, gaveUp: 0 };
  const nowIso = now.toISOString();

  // 1. Analyses bloquées (plantage, délai) : relancées, puis abandonnées après 3 essais.
  const stuckBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const { data: stuck } = await db
    .from("meeting_announcements")
    .select("*")
    .in("status", ["received", "analyzing"])
    .lt("updated_at", stuckBefore)
    .or(`lease_until.is.null,lease_until.lt."${nowIso}"`)
    .limit(20);
  for (const row of (stuck ?? []) as AnnouncementRow[]) {
    if ((row.attempts ?? 0) >= MAX_ANALYSIS_ATTEMPTS) {
      await patchAnnouncement(row.id, { status: "failed", error: row.error ?? "analysis failed 3 times" });
      if (row.source_kind !== "mirror") await replyInThread(row, ":warning: I could not read this announcement. Create the card in HubSpot (Prospection, R1 scheduled).");
      out.gaveUp++;
    } else {
      await dispatch(row.id);
      out.redispatched++;
    }
  }

  // 2. Événements en file depuis plus de 2 min (envoi au traitement perdu).
  const { data: pending } = await db
    .from("meeting_announcement_events")
    .select("announcement_id")
    .is("processed_at", null)
    .lt("created_at", new Date(now.getTime() - 2 * 60_000).toISOString())
    .limit(50);
  for (const id of new Set(((pending ?? []) as { announcement_id: string }[]).map((p) => p.announcement_id))) {
    await dispatch(id);
    out.redispatched++;
  }

  // 3. Expiration : au plus tard de (annonce + 14 j, meeting + 2 j).
  const { data: open } = await db.from("meeting_announcements").select("*").in("status", OPEN_STATUSES as string[]).limit(200);
  const openRows = (open ?? []) as AnnouncementRow[];
  for (const row of openRows) {
    const byPost = Date.parse(row.created_at) + EXPIRY_AFTER_POST_MS;
    const byMeeting = row.meeting_date ? Date.parse(`${row.meeting_date}T23:59:59Z`) + EXPIRY_AFTER_MEETING_MS : 0;
    if (now.getTime() <= Math.max(byPost, byMeeting)) continue;
    const done = await transitionStatus(row.id, OPEN_STATUSES, "expired");
    if (done) {
      await updateBotMessage(done, renderOutcome(row.proposal, { kind: "expired" }));
      out.expired++;
    }
  }

  // 4. Rappel après 24 h sans réponse, une fois, en heures ouvrées (Paris).
  if (parisBusinessHours(now)) {
    const tester = await testUserSlackId();
    for (const row of openRows) {
      if (row.reminder_sent_at || !row.bot_message_ts) continue;
      if (now.getTime() - Date.parse(row.created_at) < REMINDER_AFTER_MS) continue;
      // Réservation conditionnelle : jamais deux rappels.
      const { data: claimed } = await db
        .from("meeting_announcements")
        .update({ reminder_sent_at: nowIso })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      const recipient = row.mode === "test" ? tester : row.posted_by_slack_id;
      if (!recipient) continue;
      const link = await permalinkOf(row.thread_channel, row.bot_message_ts);
      const p = row.proposal;
      const who = p ? `${p.contacts[0]?.name ?? "your contact"}${p.company.name ? ` (${p.company.name})` : ""}` : "your meeting";
      const missing = p?.missing.length ? ` Missing: ${missingText(p.missing)}.` : "";
      await dmRecipient(
        recipient,
        `${row.mode === "test" ? ":test_tube: Test · " : ""}:alarm_clock: Reminder: the meeting with ${who} has no card yet.${missing} React ✅ to create it or ❌ to skip${link ? `: ${link}` : " on my reply in #1y-new-meetings"}.`,
      ).catch(() => null);
      out.reminded++;
    }
  }
  return out;
}
