import { getGmailAccessToken } from "./gmail";

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const GA4_API = "https://analyticsdata.googleapis.com/v1beta";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GA4KPIs {
  sessions: number;
  activeUsers: number;
  newUsers: number;
  pageViews: number;
  engagedSessions: number;
  avgDuration: number;     // seconds
  keyEvents: number;
}

export interface GA4TrafficPoint {
  date: string;
  sessions: number;
  visitors: number;
  pageViews: number;
}

export interface GA4TrafficSource {
  source: string;
  sessions: number;
  percentage: number;
  color: string;
  /** Top sub-sources within this channel (e.g. for Referral: top referring domains). */
  details?: { label: string; sessions: number }[];
}

export interface GA4TopArticle {
  path: string;
  title: string;
  sessions: number;
  pageViews: number;
}

export interface GA4DeviceBreakdown {
  device: string;         // desktop / mobile / tablet
  sessions: number;
  activeUsers: number;
  engagementRate: number; // percentage
  avgDuration: number;    // seconds
  percentage: number;     // % of total sessions
}

export interface GA4CountryBreakdown {
  country: string;
  sessions: number;
  activeUsers: number;
  percentage: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return `${n}daysAgo`;
}

// GA4 data for "today" is not yet consolidated (24-48h lag). Using "yesterday"
// as the end of our ranges makes the numbers match GA4 UI stable reports.
function endOfRange(): string {
  return "yesterday";
}

/**
 * A query period — either "last N days" or an explicit date range.
 * Date strings must be YYYY-MM-DD. GA4's API accepts both YYYY-MM-DD dates and
 * keywords like "30daysAgo"/"yesterday", so we pass through transparently.
 */
export type Period = number | { startDate: string; endDate: string };

function resolveRange(p: Period): { startDate: string; endDate: string } {
  if (typeof p === "number") return { startDate: daysAgo(p), endDate: endOfRange() };
  return p;
}

function addDaysISO(iso: string, delta: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Previous same-length window just before `p` (for WoW comparison). */
function resolvePreviousRange(p: Period): { startDate: string; endDate: string } {
  if (typeof p === "number") {
    return { startDate: daysAgo(p * 2), endDate: daysAgo(p + 1) };
  }
  const start = new Date(p.startDate + "T12:00:00Z");
  const end = new Date(p.endDate + "T12:00:00Z");
  const lengthDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = addDaysISO(p.startDate, -1);
  const prevStart = addDaysISO(prevEnd, -(lengthDays - 1));
  return { startDate: prevStart, endDate: prevEnd };
}

/** Approximate length in days, for sizing limits/windows. */
export function periodLengthDays(p: Period): number {
  if (typeof p === "number") return p;
  const start = new Date(p.startDate + "T12:00:00Z");
  const end = new Date(p.endDate + "T12:00:00Z");
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

const SOURCE_COLORS: Record<string, string> = {
  "Organic Search": "#16a34a",
  "organic": "#16a34a",
  "Direct": "#f01563",
  "(direct)": "#f01563",
  "Social": "#3b82f6",
  "Organic Social": "#3b82f6",
  "Referral": "#8b5cf6",
  "Email": "#f59e0b",
  "Paid Search": "#06b6d4",
  "Unassigned": "#9ca3af",
};

function getSourceColor(source: string): string {
  return SOURCE_COLORS[source] || "#9ca3af";
}

// ─── GA4 Data API calls ──────────────────────────────────────────────────────

async function runReport(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!GA4_PROPERTY_ID) throw new Error("GA4_PROPERTY_ID not configured");

  const res = await fetch(
    `${GA4_API}/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    // Parse known error patterns into user-friendly messages
    if (res.status === 403) {
      if (text.includes("PERMISSION_DENIED")) {
        throw new Error("Your Google account does not have access to this GA4 property. Go to Google Analytics → Admin → Property Access Management and add your email as Viewer.");
      }
      if (text.includes("insufficientPermissions") || text.includes("analytics.readonly")) {
        throw new Error("Missing analytics permission. Go to Settings → Disconnect Google → Reconnect to grant analytics access.");
      }
      throw new Error(`Access denied (403). Check that your Google account has Viewer access to GA4 property ${GA4_PROPERTY_ID}.`);
    }
    if (res.status === 401) {
      throw new Error("Google session expired. Go to Settings → Disconnect Google → Reconnect.");
    }
    if (res.status === 404) {
      throw new Error(`GA4 property ${GA4_PROPERTY_ID} not found. Check GA4_PROPERTY_ID in your environment variables.`);
    }
    throw new Error(`GA4 API error ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// ─── Exported functions ──────────────────────────────────────────────────────

/**
 * Fetch KPIs for a date range + the previous period for comparison.
 */
export async function fetchKPIs(
  userId: string,
  period: Period,
): Promise<{ current: GA4KPIs; previous: GA4KPIs }> {
  const accessToken = await getGmailAccessToken(userId);

  // WoW comparison: current window vs previous same-length window just before.
  // Naming the dateRanges lets us match rows by name in the response — GA4 adds
  // an implicit `dateRange` dimension whose order can vary, so trusting the
  // array index is fragile.
  const current = { ...resolveRange(period), name: "current" };
  const previous = { ...resolvePreviousRange(period), name: "previous" };
  const body = {
    dateRanges: [current, previous],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "screenPageViews" },
      { name: "engagedSessions" },
      { name: "averageSessionDuration" },
      { name: "keyEvents" },
    ],
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }[];
    dimensionHeaders?: { name: string }[];
  };

  const rows = data.rows || [];
  const dateRangeIdx = (data.dimensionHeaders || []).findIndex((h) => h.name === "dateRange");

  function parseRow(row: { metricValues: { value: string }[] } | undefined): GA4KPIs {
    if (!row) return { sessions: 0, activeUsers: 0, newUsers: 0, pageViews: 0, engagedSessions: 0, avgDuration: 0, keyEvents: 0 };
    const v = row.metricValues.map((m) => parseFloat(m.value) || 0);
    return {
      sessions: Math.round(v[0]),
      activeUsers: Math.round(v[1]),
      newUsers: Math.round(v[2]),
      pageViews: Math.round(v[3]),
      engagedSessions: Math.round(v[4]),
      avgDuration: Math.round(v[5]),
      keyEvents: Math.round(v[6]),
    };
  }

  // Match rows by dateRange name when the implicit dimension is present;
  // fall back to positional matching for compatibility.
  const findByName = (name: string) => {
    if (dateRangeIdx < 0) return undefined;
    return rows.find((r) => r.dimensionValues?.[dateRangeIdx]?.value === name);
  };

  return {
    current: parseRow(findByName("current") ?? rows[0]),
    previous: parseRow(findByName("previous") ?? rows[1]),
  };
}

/**
 * Fetch daily traffic data for a period.
 */
export async function fetchTrafficData(
  userId: string,
  period: Period,
): Promise<GA4TrafficPoint[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [resolveRange(period)],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "screenPageViews" },
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: periodLengthDays(period) + 1,
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  return (data.rows || []).map((row) => {
    const dateStr = row.dimensionValues[0].value; // "20260415"
    const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    return {
      date: formatted,
      sessions: Math.round(parseFloat(row.metricValues[0].value) || 0),
      visitors: Math.round(parseFloat(row.metricValues[1].value) || 0),  // = activeUsers
      pageViews: Math.round(parseFloat(row.metricValues[2].value) || 0),
    };
  });
}

/**
 * Fetch traffic sources breakdown with a sub-source detail list per channel.
 * Single GA4 call groups by (channelGroup, sourceMedium) so the hover tooltip
 * can show, e.g. for Referral: `linkedin.com / referral: 42 sessions`.
 */
export async function fetchTrafficSources(
  userId: string,
  period: Period,
): Promise<GA4TrafficSource[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [resolveRange(period)],
    dimensions: [
      { name: "sessionDefaultChannelGroup" },
      { name: "sessionSourceMedium" },
    ],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 500,
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  const rows = data.rows || [];

  // Aggregate by channel, collecting sub-source breakdown
  const byChannel = new Map<string, { sessions: number; details: Map<string, number> }>();
  let total = 0;
  for (const row of rows) {
    const channel = row.dimensionValues[0].value;
    const subSource = row.dimensionValues[1].value;
    const sessions = parseFloat(row.metricValues[0].value) || 0;
    total += sessions;

    const entry = byChannel.get(channel) ?? { sessions: 0, details: new Map() };
    entry.sessions += sessions;
    entry.details.set(subSource, (entry.details.get(subSource) ?? 0) + sessions);
    byChannel.set(channel, entry);
  }

  return Array.from(byChannel.entries())
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .slice(0, 10)
    .map(([channel, entry]) => ({
      source: channel,
      sessions: Math.round(entry.sessions),
      percentage: total > 0 ? Math.round((entry.sessions / total) * 1000) / 10 : 0,
      color: getSourceColor(channel),
      details: Array.from(entry.details.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([label, sessions]) => ({ label, sessions: Math.round(sessions) })),
    }));
}

/**
 * Fetch top pages by sessions.
 */
export async function fetchTopPages(
  userId: string,
  period: Period,
  limit = 10,
): Promise<GA4TopArticle[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [resolveRange(period)],
    dimensions: [
      { name: "pagePath" },
      { name: "pageTitle" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "screenPageViews" },
    ],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH", value: "/blog/" },
      },
    },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  return (data.rows || []).map((row) => ({
    path: row.dimensionValues[0].value,
    title: row.dimensionValues[1].value,
    sessions: Math.round(parseFloat(row.metricValues[0].value) || 0),
    pageViews: Math.round(parseFloat(row.metricValues[1].value) || 0),
  }));
}

/**
 * Fetch device breakdown (desktop / mobile / tablet) with engagement metrics.
 */
export async function fetchDeviceBreakdown(
  userId: string,
  period: Period,
): Promise<GA4DeviceBreakdown[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [resolveRange(period)],
    dimensions: [{ name: "deviceCategory" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  const rows = data.rows || [];
  const totalSessions = rows.reduce((s, r) => s + (parseFloat(r.metricValues[0].value) || 0), 0);

  return rows.map((row) => {
    const sessions = Math.round(parseFloat(row.metricValues[0].value) || 0);
    return {
      device: row.dimensionValues[0].value,
      sessions,
      activeUsers: Math.round(parseFloat(row.metricValues[1].value) || 0),
      engagementRate: Math.round((parseFloat(row.metricValues[2].value) || 0) * 1000) / 10,
      avgDuration: Math.round(parseFloat(row.metricValues[3].value) || 0),
      percentage: totalSessions > 0 ? Math.round((sessions / totalSessions) * 1000) / 10 : 0,
    };
  });
}

/**
 * Fetch top countries by sessions.
 */
export async function fetchCountryBreakdown(
  userId: string,
  period: Period,
  limit = 10,
): Promise<GA4CountryBreakdown[]> {
  const accessToken = await getGmailAccessToken(userId);

  // GA4's native "Internal Traffic" data filter doesn't always propagate to the
  // Data API (depends on whether it's Active vs Testing). Allow excluding the
  // developer's country (or any other) via env: GA4_EXCLUDED_COUNTRIES="Ukraine,..."
  const excluded = (process.env.GA4_EXCLUDED_COUNTRIES || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const body: Record<string, unknown> = {
    dateRanges: [resolveRange(period)],
    dimensions: [{ name: "country" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
    ],
    orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    limit,
  };

  if (excluded.length > 0) {
    body.dimensionFilter = {
      notExpression: {
        filter: {
          fieldName: "country",
          inListFilter: { values: excluded },
        },
      },
    };
  }

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  const rows = data.rows || [];
  const totalUsers = rows.reduce((s, r) => s + (parseFloat(r.metricValues[1].value) || 0), 0);

  return rows.map((row) => {
    const activeUsers = Math.round(parseFloat(row.metricValues[1].value) || 0);
    return {
      country: row.dimensionValues[0].value || "(not set)",
      sessions: Math.round(parseFloat(row.metricValues[0].value) || 0),
      activeUsers,
      percentage: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 1000) / 10 : 0,
    };
  });
}

/**
 * Fetch detailed stats for a single article page path.
 */
export interface ArticleStats {
  sessions: number;
  pageViews: number;
  avgDuration: number; // seconds
  bounceRate: number; // percentage
  users: number;
  engagementRate: number; // percentage
}

export async function fetchArticleStats(
  userId: string,
  pagePath: string,
  period: Period = 30,
): Promise<ArticleStats | null> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [resolveRange(period)],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
      { name: "totalUsers" },
      { name: "engagementRate" },
    ],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "EXACT", value: pagePath },
      },
    },
    limit: 1,
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  const row = (data.rows || [])[0];
  if (!row) return null;

  const v = row.metricValues.map((m) => parseFloat(m.value) || 0);
  return {
    sessions: Math.round(v[0]),
    pageViews: Math.round(v[1]),
    avgDuration: Math.round(v[2]),
    bounceRate: Math.round(v[3] * 1000) / 10,
    users: Math.round(v[4]),
    engagementRate: Math.round(v[5] * 1000) / 10,
  };
}
