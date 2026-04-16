import { getGmailAccessToken } from "./gmail";

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const GA4_API = "https://analyticsdata.googleapis.com/v1beta";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GA4KPIs {
  sessions: number;
  uniqueVisitors: number;
  pageViews: number;
  bounceRate: number;
  avgDuration: number; // seconds
  ctaConversions: number;
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
}

export interface GA4TopArticle {
  path: string;
  title: string;
  sessions: number;
  pageViews: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return `${n}daysAgo`;
}

function todayStr(): string {
  return "today";
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
    throw new Error(`GA4 API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Exported functions ──────────────────────────────────────────────────────

/**
 * Fetch KPIs for a date range + the previous period for comparison.
 */
export async function fetchKPIs(
  userId: string,
  periodDays: number,
): Promise<{ current: GA4KPIs; previous: GA4KPIs }> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [
      { startDate: daysAgo(periodDays), endDate: todayStr() },
      { startDate: daysAgo(periodDays * 2), endDate: daysAgo(periodDays + 1) },
    ],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "screenPageViews" },
      { name: "bounceRate" },
      { name: "averageSessionDuration" },
      { name: "eventCount" },
    ],
  };

  const data = await runReport(accessToken, body) as {
    rows?: { metricValues: { value: string }[] }[];
  };

  const rows = data.rows || [];

  function parseRow(row: { metricValues: { value: string }[] } | undefined): GA4KPIs {
    if (!row) return { sessions: 0, uniqueVisitors: 0, pageViews: 0, bounceRate: 0, avgDuration: 0, ctaConversions: 0 };
    const v = row.metricValues.map((m) => parseFloat(m.value) || 0);
    return {
      sessions: Math.round(v[0]),
      uniqueVisitors: Math.round(v[1]),
      pageViews: Math.round(v[2]),
      bounceRate: Math.round(v[3] * 1000) / 10, // e.g. 0.423 → 42.3
      avgDuration: Math.round(v[4]),
      ctaConversions: Math.round(v[5]),
    };
  }

  return {
    current: parseRow(rows[0]),
    previous: parseRow(rows[1]),
  };
}

/**
 * Fetch daily traffic data for a period.
 */
export async function fetchTrafficData(
  userId: string,
  periodDays: number,
): Promise<GA4TrafficPoint[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [{ startDate: daysAgo(periodDays), endDate: todayStr() }],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "screenPageViews" },
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: periodDays + 1,
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
      visitors: Math.round(parseFloat(row.metricValues[1].value) || 0),
      pageViews: Math.round(parseFloat(row.metricValues[2].value) || 0),
    };
  });
}

/**
 * Fetch traffic sources breakdown.
 */
export async function fetchTrafficSources(
  userId: string,
  periodDays: number,
): Promise<GA4TrafficSource[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [{ startDate: daysAgo(periodDays), endDate: todayStr() }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  };

  const data = await runReport(accessToken, body) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  const rows = data.rows || [];
  const total = rows.reduce((s, r) => s + (parseFloat(r.metricValues[0].value) || 0), 0);

  return rows.map((row) => {
    const source = row.dimensionValues[0].value;
    const sessions = Math.round(parseFloat(row.metricValues[0].value) || 0);
    return {
      source,
      sessions,
      percentage: total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0,
      color: getSourceColor(source),
    };
  });
}

/**
 * Fetch top pages by sessions.
 */
export async function fetchTopPages(
  userId: string,
  periodDays: number,
  limit = 10,
): Promise<GA4TopArticle[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body = {
    dateRanges: [{ startDate: daysAgo(periodDays), endDate: todayStr() }],
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
