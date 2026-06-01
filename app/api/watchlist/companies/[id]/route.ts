import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBriefs, type BriefRow, type AeAnalysisContent, type NewsContent } from "@/lib/watchlist/briefs";

export const dynamic = "force-dynamic";

// Conservé pour compat de signature : la prospection passe désormais par les listes.
export interface WatchProspect {
  id: string;
  is_champion: boolean;
  hubspot_id: string | null;
}

export interface WatchCompanyDetail {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
  hubspot_company_id: string | null;
}

export interface WatchCompanyDetailResponse {
  company: WatchCompanyDetail | null;
  prospects: WatchProspect[];
  briefs: {
    ae_analysis: BriefRow<AeAnalysisContent> | null;
    news: BriefRow<NewsContent> | null;
  };
  signals_30d: { count: number; last_at: string | null };
  outreach_count: number;
  error?: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY: Omit<WatchCompanyDetailResponse, "error"> = {
  company: null,
  prospects: [],
  briefs: { ae_analysis: null, news: null },
  signals_30d: { count: 0, last_at: null },
  outreach_count: 0,
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ...EMPTY, error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name, owner, sector, current_coaching_platform, notes, hubspot_company_id")
    .eq("id", id)
    .maybeSingle();

  if (companyErr) {
    // Erreur SQL (ex: colonne absente parce que la migration n'est pas appliquée)
    return NextResponse.json(
      { ...EMPTY, error: `Erreur DB: ${companyErr.message}` },
      { status: 500 },
    );
  }
  if (!company) {
    return NextResponse.json({ ...EMPTY, error: "Compte introuvable" }, { status: 404 });
  }

  const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const [briefs, signalsRes] = await Promise.all([
    getBriefs(company.id),
    db
      .from("market_signals")
      .select("created_at")
      .eq("user_id", user.id)
      .ilike("company_name", company.name)
      .eq("archived", false)
      .gte("created_at", sinceIso),
  ]);

  const signals = signalsRes.data ?? [];
  const signals_30d = {
    count: signals.length,
    last_at: signals.reduce<string | null>(
      (acc, s) => (acc == null || s.created_at > acc ? s.created_at : acc),
      null,
    ),
  };

  const response: WatchCompanyDetailResponse = {
    company,
    prospects: [],
    briefs,
    signals_30d,
    outreach_count: 0,
  };

  return NextResponse.json(response);
}
