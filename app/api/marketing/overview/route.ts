import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { fetchKPIs, fetchTrafficData, fetchTrafficSources, fetchTopPages } from "@/lib/google-analytics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const period = parseInt(req.nextUrl.searchParams.get("period") || "30", 10);
  const validPeriod = [7, 14, 30, 90, 365].includes(period) ? period : 30;

  if (!process.env.GA4_PROPERTY_ID) {
    return NextResponse.json({
      kpis: null, trafficData: [], trafficSources: [], topPages: [],
      source: "none",
      ga4Error: "GA4_PROPERTY_ID not set. Add it in your environment variables.",
    });
  }

  const [kpiResult, trafficResult, sourcesResult, pagesResult] = await Promise.allSettled([
    fetchKPIs(user.id, validPeriod),
    fetchTrafficData(user.id, validPeriod),
    fetchTrafficSources(user.id, validPeriod),
    fetchTopPages(user.id, validPeriod, 10),
  ]);

  const errorSet = new Set<string>();
  for (const r of [kpiResult, trafficResult, sourcesResult, pagesResult]) {
    if (r.status === "rejected") errorSet.add(r.reason?.message || String(r.reason));
  }
  const ga4Errors = Array.from(errorSet);

  if (kpiResult.status === "rejected") {
    return NextResponse.json({
      kpis: null, trafficData: [], trafficSources: [], topPages: [],
      source: "none",
      ga4Error: ga4Errors.join(" | "),
    });
  }

  const { current: cur, previous: prev } = kpiResult.value;
  const wow = (c: number, p: number) => p === 0 ? 0 : Math.round(((c - p) / p) * 1000) / 10;

  return NextResponse.json({
    kpis: {
      sessions: cur.sessions, sessionsWoW: wow(cur.sessions, prev.sessions),
      uniqueVisitors: cur.uniqueVisitors, uniqueVisitorsWoW: wow(cur.uniqueVisitors, prev.uniqueVisitors),
      pageViews: cur.pageViews, pageViewsWoW: wow(cur.pageViews, prev.pageViews),
      bounceRate: cur.bounceRate, bounceRateWoW: wow(cur.bounceRate, prev.bounceRate),
      avgDuration: cur.avgDuration, avgDurationWoW: wow(cur.avgDuration, prev.avgDuration),
      ctaConversions: cur.ctaConversions, ctaConversionsWoW: wow(cur.ctaConversions, prev.ctaConversions),
    },
    trafficData: trafficResult.status === "fulfilled" ? trafficResult.value : [],
    trafficSources: sourcesResult.status === "fulfilled" ? sourcesResult.value : [],
    topPages: pagesResult.status === "fulfilled" ? pagesResult.value : [],
    source: "ga4",
    ga4Error: ga4Errors.length > 0 ? ga4Errors.join(" | ") : undefined,
  });
}
