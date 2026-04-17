import { getGmailAccessToken } from "./gmail";
import type { Keyword, CannibalizationAlert } from "./marketing-types";

const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const SEARCH_CONSOLE_SITE = process.env.SEARCH_CONSOLE_SITE_URL;

// ─── Search Analytics API ────────────────────────────────────────────────────

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function querySearchAnalytics(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<SearchAnalyticsRow[]> {
  if (!SEARCH_CONSOLE_SITE) throw new Error("SEARCH_CONSOLE_SITE_URL not configured. Set it in your environment variables.");

  const encodedSite = encodeURIComponent(SEARCH_CONSOLE_SITE);
  const res = await fetch(
    `${SEARCH_CONSOLE_API}/sites/${encodedSite}/searchAnalytics/query`,
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
    if (res.status === 403) {
      if (text.includes("insufficientPermissions") || text.includes("PERMISSION_DENIED")) {
        throw new Error("Your Google account does not have access to Search Console for this site. Go to Settings → Disconnect Google → Reconnect.");
      }
      throw new Error(`Search Console access denied. Make sure your Google account has access to ${SEARCH_CONSOLE_SITE} in Search Console.`);
    }
    if (res.status === 401) {
      throw new Error("Google session expired. Go to Settings → Disconnect Google → Reconnect.");
    }
    throw new Error(`Search Console API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.rows || [];
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Exported functions ──────────────────────────────────────────────────────

/**
 * Fetch all keywords with metrics, optionally filtered to blog pages.
 */
export async function fetchKeywords(
  userId: string,
  days = 28,
  blogOnly = true,
): Promise<Keyword[]> {
  const accessToken = await getGmailAccessToken(userId);

  const body: Record<string, unknown> = {
    startDate: daysAgoISO(days),
    endDate: daysAgoISO(1), // Search Console data has 1-2 day lag
    dimensions: ["query", "page"],
    rowLimit: 500,
    dataState: "all",
  };

  if (blogOnly) {
    body.dimensionFilterGroups = [{
      filters: [{
        dimension: "page",
        operator: "contains",
        expression: "/blog/",
      }],
    }];
  }

  const rows = await querySearchAnalytics(accessToken, body);

  return rows.map((row) => {
    const page = row.keys[1] || "";
    // Extract a readable title from the URL path
    const slug = page.replace(/.*\/blog\//, "").replace(/\/$/, "");
    const pageTitle = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 80);

    return {
      keyword: row.keys[0],
      page,
      pageTitle: pageTitle || null,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: Math.round(row.ctr * 1000) / 10, // 0.032 → 3.2%
      position: Math.round(row.position * 10) / 10,
    };
  });
}

/**
 * Detect keyword cannibalization: same keyword ranking for multiple pages.
 */
export function detectCannibalization(keywords: Keyword[]): CannibalizationAlert[] {
  // Group keywords by query
  const byQuery = new Map<string, Keyword[]>();
  for (const kw of keywords) {
    if (!kw.page) continue;
    const existing = byQuery.get(kw.keyword) || [];
    existing.push(kw);
    byQuery.set(kw.keyword, existing);
  }

  // Find queries that appear on multiple pages
  const alerts: CannibalizationAlert[] = [];
  for (const [keyword, entries] of byQuery) {
    // Deduplicate by page
    const uniquePages = new Map<string, Keyword>();
    for (const e of entries) {
      if (!uniquePages.has(e.page!)) uniquePages.set(e.page!, e);
    }
    if (uniquePages.size >= 2) {
      alerts.push({
        keyword,
        articles: Array.from(uniquePages.values()).map((e) => ({
          page: e.page!,
          title: e.pageTitle || e.page!,
          position: e.position,
          impressions: e.impressions,
        })),
      });
    }
  }

  // Sort by total impressions (most impactful cannibalization first)
  return alerts
    .sort((a, b) => {
      const aImp = a.articles.reduce((s, x) => s + x.impressions, 0);
      const bImp = b.articles.reduce((s, x) => s + x.impressions, 0);
      return bImp - aImp;
    })
    .slice(0, 10);
}
