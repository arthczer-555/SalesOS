import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getBriefs, type BriefRow, type AeAnalysisContent, type NewsContent } from "@/lib/watchlist/briefs";

export const dynamic = "force-dynamic";

export interface BriefsResponse {
  briefs: {
    ae_analysis: BriefRow<AeAnalysisContent> | null;
    news: BriefRow<NewsContent> | null;
  };
  error?: string;
}

const EMPTY_BRIEFS = { ae_analysis: null, news: null };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ briefs: EMPTY_BRIEFS, error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const briefs = await getBriefs(id);
    return NextResponse.json({ briefs });
  } catch (e) {
    return NextResponse.json(
      { briefs: EMPTY_BRIEFS, error: e instanceof Error ? e.message : "Erreur briefs" },
      { status: 500 },
    );
  }
}
