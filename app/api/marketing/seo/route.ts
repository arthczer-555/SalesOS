import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { fetchKeywords, detectCannibalization } from "@/lib/google-search-console";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.SEARCH_CONSOLE_SITE_URL) {
    return NextResponse.json({
      keywords: [],
      cannibalizationAlerts: [],
      error: "SEARCH_CONSOLE_SITE_URL not set. Add it in your environment variables.",
    });
  }

  const days = parseInt(req.nextUrl.searchParams.get("days") || "28", 10);
  const opportunitiesOnly = req.nextUrl.searchParams.get("opportunities") === "true";

  try {
    let keywords = await fetchKeywords(user.id, days);

    if (opportunitiesOnly) {
      keywords = keywords.filter((k) => k.position >= 5 && k.position <= 20 && k.ctr < 3);
    }

    const cannibalizationAlerts = detectCannibalization(keywords);

    return NextResponse.json({ keywords, cannibalizationAlerts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[marketing/seo] Search Console error:", msg);
    return NextResponse.json({
      keywords: [],
      cannibalizationAlerts: [],
      error: msg,
    });
  }
}
