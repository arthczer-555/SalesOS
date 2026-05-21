import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  startBriefRun,
  finishBriefOk,
  finishBriefError,
  type BriefRow,
  type NewsContent,
} from "@/lib/watchlist/briefs";
import { fetchWatchlistNews } from "@/lib/watchlist/fetch-news";

export const dynamic = "force-dynamic";

export interface RefreshNewsResponse {
  ok: boolean;
  alreadyRunning?: boolean;
  brief?: BriefRow<NewsContent> | null;
  error?: string;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name")
    .eq("id", id)
    .single();

  if (companyErr || !company) {
    return NextResponse.json({ ok: false, error: "Compte introuvable" }, { status: 404 });
  }

  // Lock 5 min anti double-dispatch
  const { alreadyRunning } = await startBriefRun({
    scopeCompanyId: id,
    kind: "news",
    userId: user.id,
  });
  if (alreadyRunning) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  try {
    const content = await fetchWatchlistNews({
      scopeCompanyId: id,
      userId: user.id,
      companyName: company.name,
    });

    await finishBriefOk({ scopeCompanyId: id, kind: "news", content });

    // Renvoie la brief fraîche pour update SWR sans re-fetch
    const { data: brief } = await db
      .from("watchlist_company_briefs")
      .select("*")
      .eq("scope_company_id", id)
      .eq("kind", "news")
      .single();

    return NextResponse.json({ ok: true, brief: brief as BriefRow<NewsContent> | null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishBriefError({ scopeCompanyId: id, kind: "news", error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
