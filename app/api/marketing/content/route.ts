import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-memory state for the content factory pipeline (per-session, resets on redeploy)
let analysisResult: Record<string, unknown> | null = null;
let recommendations: { id: string; topic: string; targetKeyword: string; justification: string; estimatedTraffic: number; difficulty: string; priority: string; status: string }[] = [];
let drafts: Record<string, unknown>[] = [];

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({
    analysis: analysisResult,
    recommendations,
    drafts,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { action, recommendationId } = body;

  if (action === "analyze") {
    // In production: call Claude with GA4 + Search Console data
    // For now: return empty analysis prompting user to connect data sources
    analysisResult = {
      topPerformers: [],
      risingTrends: [],
      contentGaps: [],
      message: "Connect GA4 and Search Console to get AI-powered content analysis.",
    };
    return NextResponse.json({ analysis: analysisResult });
  }

  if (action === "approve" && recommendationId) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (rec) rec.status = "approved";
    return NextResponse.json({ success: true, recommendations });
  }

  if (action === "reject" && recommendationId) {
    recommendations = recommendations.filter((r) => r.id !== recommendationId);
    return NextResponse.json({ success: true, recommendations });
  }

  if (action === "generate" && recommendationId) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (rec) rec.status = "writing";
    // In production: call Claude to write the article
    return NextResponse.json({ success: true, draft: null, recommendations });
  }

  if (action === "publish" && recommendationId) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (rec) rec.status = "published";
    return NextResponse.json({ success: true, recommendations });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
