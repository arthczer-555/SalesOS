// Leads live in the Slack channel #1a-new-incoming-leads and are mirrored
// into the `leads` Supabase table via the sync endpoint. The "Incoming Leads"
// KPI on the marketing overview reads from the table and counts only
// validated rows — not every Slack message.

import { db } from "./db";
import { LEADS_CHANNEL } from "./slack/key-channels";

const SLACK_API = "https://slack.com/api";

interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  thumb_360?: string;
  thumb_480?: string;
  thumb_720?: string;
}

interface SlackMessage {
  ts: string;
  subtype?: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  files?: SlackFile[];
}

interface SlackChannel {
  id: string;
  name: string;
  is_archived?: boolean;
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
  };
}

async function slackGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not configured");

  const url = new URL(`${SLACK_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error ?? "unknown error"}`);
  return data as T;
}

/**
 * Resolve a Slack channel name ("1a-new-incoming-leads") to its channel ID.
 * Paginated scan of public + private channels the bot is a member of.
 */
export async function findChannelId(name: string): Promise<string | null> {
  const target = name.replace(/^#/, "").toLowerCase();
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      limit: "200",
      types: "public_channel,private_channel",
      exclude_archived: "true",
    };
    if (cursor) params.cursor = cursor;
    const data = await slackGet<{ channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(
      "/conversations.list",
      params,
    );
    const match = (data.channels ?? []).find((c) => c.name.toLowerCase() === target);
    if (match) return match.id;
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return null;
}

/** Convert Slack "ts" (unix seconds, possibly fractional) to YYYY-MM-DD in Europe/Paris. */
function tsToParisDate(ts: string): string {
  const seconds = parseFloat(ts);
  if (!Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  return date.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

/** Convert an ISO timestamp to YYYY-MM-DD in Europe/Paris. */
function isoToParisDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

export interface IncomingLeadsCount {
  current: number;
  previous: number;
  channelFound: boolean;
  /** Daily leads count for the current window only (YYYY-MM-DD → count). */
  dailyCounts: Record<string, number>;
}

/** Either a number of days back from now, or an explicit date range. */
export type SlackPeriod = number | { startDate: string; endDate: string };

/** End-of-day timestamp for a YYYY-MM-DD date in Europe/Paris (approx UTC+1/2). */
function dateToTimestamp(date: string, endOfDay = false): number {
  const d = new Date(date + (endOfDay ? "T23:59:59Z" : "T00:00:00Z"));
  return Math.floor(d.getTime() / 1000);
}

function resolveSlackRange(p: SlackPeriod): { oldest: number; latest: number; lengthSec: number } {
  if (typeof p === "number") {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;
    return { oldest: now - p * oneDay, latest: now, lengthSec: p * oneDay };
  }
  const oldest = dateToTimestamp(p.startDate, false);
  const latest = dateToTimestamp(p.endDate, true);
  return { oldest, latest, lengthSec: latest - oldest };
}

/**
 * Count VALIDATED leads in the `leads` table for the current window and
 * the previous same-length window just before it, with per-day buckets
 * for the current window (Europe/Paris timezone).
 *
 * Note: returns 0 if Supabase isn't configured — the KPI silently degrades.
 */
export async function countIncomingLeads(period: SlackPeriod): Promise<IncomingLeadsCount> {
  const { oldest, latest, lengthSec } = resolveSlackRange(period);
  const currentStart = new Date(oldest * 1000).toISOString();
  const currentEnd = new Date(latest * 1000).toISOString();
  const previousStart = new Date((oldest - lengthSec) * 1000).toISOString();
  const previousEnd = currentStart;

  const [currentRes, previousRes] = await Promise.all([
    db
      .from("leads")
      .select("posted_at")
      .eq("validation_status", "validated")
      .gte("posted_at", currentStart)
      .lte("posted_at", currentEnd),
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("validation_status", "validated")
      .gte("posted_at", previousStart)
      .lte("posted_at", previousEnd),
  ]);

  if (currentRes.error) throw new Error(`leads query failed: ${currentRes.error.message}`);
  if (previousRes.error) throw new Error(`leads query failed: ${previousRes.error.message}`);

  const currentRows = (currentRes.data ?? []) as { posted_at: string }[];
  const dailyCounts: Record<string, number> = {};
  for (const row of currentRows) {
    const day = isoToParisDate(row.posted_at);
    if (day) dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
  }

  return {
    current: currentRows.length,
    previous: previousRes.count ?? 0,
    channelFound: true,
    dailyCounts,
  };
}

// ─── Sync from Slack (used by /api/marketing/leads/sync) ─────────────────────

export interface SlackLeadMessage {
  slack_ts: string;
  slack_channel_id: string;
  slack_permalink: string | null;
  author_id: string | null;
  author_name: string | null;
  text: string;
  files: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private: string;
    thumb_url?: string;
  }>;
  posted_at: string;
}

/**
 * Exported so the sync endpoint can resolve the channel once and reuse it.
 * Known ID first (one conversations.info call, which also fails if the bot
 * is not in the private channel), then a scan by name in case it changed.
 */
export async function resolveLeadsChannelId(): Promise<string | null> {
  try {
    await slackGet("/conversations.info", { channel: LEADS_CHANNEL.id });
    return LEADS_CHANNEL.id;
  } catch {
    return findChannelId(LEADS_CHANNEL.name);
  }
}

function extractAuthorName(user: SlackUser | null): string | null {
  if (!user) return null;
  return (
    user.profile?.display_name ||
    user.profile?.real_name ||
    user.real_name ||
    user.name ||
    null
  );
}

async function fetchUserInfoCached(
  userId: string,
  cache: Map<string, SlackUser | null>,
): Promise<SlackUser | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  try {
    const data = await slackGet<{ user?: SlackUser }>("/users.info", { user: userId });
    const user = data.user ?? null;
    cache.set(userId, user);
    return user;
  } catch {
    cache.set(userId, null);
    return null;
  }
}

const MENTION_REGEX = /<@([UW][A-Z0-9]+)>/g;

/**
 * Replace Slack user mentions `<@Uxxxx>` in a message body with `@DisplayName`.
 * Falls back to the raw `<@Uxxxx>` token when the user can't be resolved.
 */
export async function resolveMentionsInText(
  text: string,
  cache: Map<string, SlackUser | null>,
): Promise<string> {
  if (!text || !text.includes("<@")) return text;
  const ids = Array.from(new Set(Array.from(text.matchAll(MENTION_REGEX), (m) => m[1])));
  if (ids.length === 0) return text;

  await Promise.all(ids.map((id) => fetchUserInfoCached(id, cache)));

  return text.replace(MENTION_REGEX, (raw, id: string) => {
    const name = extractAuthorName(cache.get(id) ?? null);
    return name ? `@${name}` : raw;
  });
}

async function fetchPermalink(channelId: string, ts: string): Promise<string | null> {
  try {
    const data = await slackGet<{ permalink?: string }>("/chat.getPermalink", {
      channel: channelId,
      message_ts: ts,
    });
    return data.permalink ?? null;
  } catch {
    return null;
  }
}

function pickThumb(file: SlackFile): string | undefined {
  return file.thumb_480 || file.thumb_360 || file.thumb_720;
}

/**
 * Fetch one page of lead messages from Slack since `oldestTs` (exclusive).
 * Returns enriched messages (files + permalink + author name) and the next
 * cursor. Commit the page to DB before fetching the next one so progress
 * survives timeouts during large backfills.
 */
export async function fetchLeadMessagesPage(
  channelId: string,
  oldestTs: string | null,
  cursor: string | null,
  userCache: Map<string, SlackUser | null>,
  defaultOldestIso: string = "2025-01-01T00:00:00Z",
): Promise<{ messages: SlackLeadMessage[]; nextCursor: string | null }> {
  const oldestSec = oldestTs
    ? parseFloat(oldestTs)
    : Math.floor(new Date(defaultOldestIso).getTime() / 1000);
  const latestSec = Math.floor(Date.now() / 1000);

  const params: Record<string, string> = {
    channel: channelId,
    oldest: oldestSec.toString(),
    latest: latestSec.toString(),
    limit: "100",
    inclusive: "false",
  };
  if (cursor) params.cursor = cursor;

  const data = await slackGet<{
    messages?: SlackMessage[];
    response_metadata?: { next_cursor?: string };
  }>("/conversations.history", params);

  const rawMessages = (data.messages ?? []).filter((msg) => {
    if (msg.subtype && msg.subtype !== "bot_message") return false;
    if (msg.thread_ts && msg.thread_ts !== msg.ts) return false;
    if (oldestTs && msg.ts === oldestTs) return false;
    return true;
  });

  // Hydrate permalink + user info in parallel across the whole page.
  const enriched = await Promise.all(
    rawMessages.map(async (msg) => {
      const rawText = msg.text ?? "";
      const [permalink, user, text] = await Promise.all([
        fetchPermalink(channelId, msg.ts),
        msg.user ? fetchUserInfoCached(msg.user, userCache) : Promise.resolve(null),
        resolveMentionsInText(rawText, userCache),
      ]);

      const files = (msg.files ?? [])
        .filter((f) => f.id && f.url_private)
        .map((f) => ({
          id: f.id,
          name: f.name ?? "",
          mimetype: f.mimetype ?? "",
          url_private: f.url_private ?? "",
          thumb_url: pickThumb(f),
        }));

      return {
        slack_ts: msg.ts,
        slack_channel_id: channelId,
        slack_permalink: permalink,
        author_id: msg.user ?? null,
        author_name: extractAuthorName(user),
        text,
        files,
        posted_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
      } satisfies SlackLeadMessage;
    }),
  );

  return {
    messages: enriched,
    nextCursor: data.response_metadata?.next_cursor || null,
  };
}
