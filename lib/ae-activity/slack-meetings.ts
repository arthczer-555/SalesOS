// ────────────────────────────────────────────────────────────────────────
// Meetings auto-déclarés par les reps dans le canal Slack #1y-new-meetings.
//
// Chaque message top-level d'un humain = un meeting déclaré, daté du message.
// Attribution PAR EMAIL du posteur (résolu via users.info) plutôt que par
// users.slack_user_id : plus robuste (tous les reps ont un email, alors que
// slack_user_id peut manquer en base). Fallback sur le slack user id.
//
// Best-effort, derrière l'env SLACK_NEW_MEETINGS_CHANNEL : inerte tant que le
// canal n'est pas configuré (le KPI affiche alors "-").
// ────────────────────────────────────────────────────────────────────────

import { toDayString } from "./aggregate";
import type { SlackBookedMeeting } from "./types";

// Longueur max conservée par message : de quoi identifier le prospect dans le
// drill-down sans gonfler le payload JSONB du snapshot.
const MAX_TEXT_LEN = 300;

type SlackMessage = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
};

type HistoryResponse = {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

type UserInfoResponse = {
  ok: boolean;
  error?: string;
  user?: { profile?: { email?: string } };
};

/**
 * Map clé → meetings déclarés depuis `startDay`. La clé est l'email du posteur
 * (lowercase) quand résolu, sinon son slack user id.
 * Best-effort : map vide si le canal ou le token ne sont pas configurés.
 */
export async function fetchSlackSelfBookedMeetings(
  startDay: string,
): Promise<Map<string, SlackBookedMeeting[]>> {
  const out = new Map<string, SlackBookedMeeting[]>();
  const channel = process.env.SLACK_NEW_MEETINGS_CHANNEL;
  // Bot token en priorité (a le scope channels:history + users:read.email).
  // Fallback user token.
  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
  if (!channel || !token) return out;

  const oldest = String(Math.floor(Date.parse(`${startDay}T00:00:00Z`) / 1000));

  // 1) Collecte des meetings par slack user id (posteur).
  const byUid = new Map<string, SlackBookedMeeting[]>();
  let cursor: string | undefined;
  let guard = 0;
  try {
    do {
      const qs = new URLSearchParams({ channel, oldest, limit: "200" });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`https://slack.com/api/conversations.history?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as HistoryResponse;
      if (!data.ok) {
        console.warn("[ae-activity] slack history error:", data.error);
        break;
      }
      for (const m of data.messages ?? []) {
        // Messages top-level d'un humain uniquement (pas de bots, events système,
        // ni réponses en thread).
        if (m.subtype || m.bot_id || !m.user || !m.ts) continue;
        if (m.thread_ts && m.thread_ts !== m.ts) continue;
        const day = toDayString(String(Math.floor(Number(m.ts) * 1000)));
        if (!day) continue;
        const arr = byUid.get(m.user) ?? [];
        arr.push({ day, ts: m.ts, text: (m.text ?? "").slice(0, MAX_TEXT_LEN) });
        byUid.set(m.user, arr);
      }
      cursor = data.response_metadata?.next_cursor || undefined;
      guard++;
    } while (cursor && guard < 20);
  } catch (e) {
    console.warn("[ae-activity] slack history failed:", e instanceof Error ? e.message : e);
    return out;
  }

  // 2) Résout chaque posteur uid → email et ré-agrège par email (fallback uid).
  for (const [uid, meetings] of byUid) {
    let key = uid;
    try {
      const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as UserInfoResponse;
      const email = j.ok ? j.user?.profile?.email?.toLowerCase() : undefined;
      if (email) key = email;
    } catch {
      // garde l'uid comme clé
    }
    out.set(key, (out.get(key) ?? []).concat(meetings));
  }

  return out;
}
