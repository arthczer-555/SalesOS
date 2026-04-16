import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  fetchKPIs,
  fetchTrafficData,
  fetchTrafficSources,
  fetchTopPages,
} from "@/lib/google-analytics";
import {
  MOCK_KPIS,
  MOCK_TRAFFIC_DATA,
  MOCK_ARTICLE_MARKERS,
  MOCK_TRAFFIC_SOURCES,
} from "@/lib/mock/marketing-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const period = parseInt(req.nextUrl.searchParams.get("period") || "30", 10);
  const validPeriod = [7, 14, 30, 90, 365].includes(period) ? period : 30;

  const hasGA4 = !!process.env.GA4_PROPERTY_ID;

  if (!hasGA4) {
    // No GA4 configured — return mock with clear message
    return NextResponse.json({
      kpis: MOCK_KPIS,
      trafficData: MOCK_TRAFFIC_DATA.slice(-validPeriod),
      trafficSources: MOCK_TRAFFIC_SOURCES,
      topPages: [],
      articleMarkers: MOCK_ARTICLE_MARKERS,
      source: "mock",
      ga4Error: "GA4_PROPERTY_ID not set in environment variables",
    });
  }

  // Try each GA4 call independently so partial failures don't kill everything
  const errors: string[] = [];

  const [kpiResult, trafficResult, sourcesResult, pagesResult] = await Promise.allSettled([
    fetchKPIs(user.id, validPeriod),
    fetchTrafficData(user.id, validPeriod),
    fetchTrafficSources(user.id, validPeriod),
    fetchTopPages(user.id, validPeriod, 10),
  ]);

  // Log any failures
  if (kpiResult.status === "rejected") errors.push(`KPIs: ${kpiResult.reason?.message || kpiResult.reason}`);
  if (trafficResult.status === "rejected") errors.push(`Traffic: ${trafficResult.reason?.message || trafficResult.reason}`);
  if (sourcesResult.status === "rejected") errors.push(`Sources: ${sourcesResult.reason?.message || sourcesResult.reason}`);
  if (pagesResult.status === "rejected") errors.push(`Pages: ${pagesResult.reason?.message || pagesResult.reason}`);

  if (errors.length > 0) {
    console.error("[marketing/overview] GA4 errors:", errors.join(" | "));
  }

  // If KPIs failed, fall back entirely to mock (KPIs are essential)
  if (kpiResult.status === "rejected") {
    return NextResponse.json({
      kpis: MOCK_KPIS,
      trafficData: MOCK_TRAFFIC_DATA.slice(-validPeriod),
      trafficSources: MOCK_TRAFFIC_SOURCES,
      topPages: [],
      articleMarkers: MOCK_ARTICLE_MARKERS,
      source: "mock",
      ga4Error: errors.join(" | "),
    });
  }

  // KPIs succeeded — build response with real data where available
  const kpiData = kpiResult.value;
  const cur = kpiData.current;
  const prev = kpiData.previous;

  function wow(current: number, previous: number): number {
    if (previous === 0) return 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  const kpis = {
    sessions: cur.sessions,
    sessionsWoW: wow(cur.sessions, prev.sessions),
    uniqueVisitors: cur.uniqueVisitors,
    uniqueVisitorsWoW: wow(cur.uniqueVisitors, prev.uniqueVisitors),
    pageViews: cur.pageViews,
    pageViewsWoW: wow(cur.pageViews, prev.pageViews),
    bounceRate: cur.bounceRate,
    bounceRateWoW: wow(cur.bounceRate, prev.bounceRate),
    avgDuration: cur.avgDuration,
    avgDurationWoW: wow(cur.avgDuration, prev.avgDuration),
    ctaConversions: cur.ctaConversions,
    ctaConversionsWoW: wow(cur.ctaConversions, prev.ctaConversions),
  };

  return NextResponse.json({
    kpis,
    trafficData: trafficResult.status === "fulfilled" ? trafficResult.value : MOCK_TRAFFIC_DATA.slice(-validPeriod),
    trafficSources: sourcesResult.status === "fulfilled" ? sourcesResult.value : MOCK_TRAFFIC_SOURCES,
    topPages: pagesResult.status === "fulfilled" ? pagesResult.value : [],
    articleMarkers: MOCK_ARTICLE_MARKERS,
    source: "ga4",
    ga4Error: errors.length > 0 ? errors.join(" | ") : undefined,
  });
}
