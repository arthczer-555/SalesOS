import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBriefs, type BriefRow, type AiSummaryContent, type NewsContent, type HubspotRecapContent } from "@/lib/watchlist/briefs";
import type { WatchProspect } from "@/app/api/watchlist/accounts/[id]/prospects/route";

export const dynamic = "force-dynamic";

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
    ai_summary: BriefRow<AiSummaryContent> | null;
    news: BriefRow<NewsContent> | null;
    hubspot_recap: BriefRow<HubspotRecapContent> | null;
  };
  signals_30d: { count: number; last_at: string | null };
  outreach_count: number;
  error?: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY: Omit<WatchCompanyDetailResponse, "error"> = {
  company: null,
  prospects: [],
  briefs: { ai_summary: null, news: null, hubspot_recap: null },
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

  const [prospectsRes, briefs, signalsRes] = await Promise.all([
    db
      .from("linkedin_monitored_profiles")
      .select(
        "id, username, full_name, headline, company, profile_url, source, is_champion, hubspot_id, email, last_change_at, last_refreshed_at, created_at",
      )
      .eq("radar_active", true)
      .ilike("company", company.name)
      .order("is_champion", { ascending: false })
      .order("last_change_at", { ascending: false, nullsFirst: false }),
    getBriefs(company.id),
    db
      .from("market_signals")
      .select("created_at")
      .eq("user_id", user.id)
      .ilike("company_name", company.name)
      .eq("archived", false)
      .gte("created_at", sinceIso),
  ]);

  const prospects = (prospectsRes.data ?? []) as WatchProspect[];

  const signals = signalsRes.data ?? [];
  const signals_30d = {
    count: signals.length,
    last_at: signals.reduce<string | null>(
      (acc, s) => (acc == null || s.created_at > acc ? s.created_at : acc),
      null,
    ),
  };

  const hubspotIds = prospects.map((p) => p.hubspot_id).filter((h): h is string => !!h);
  let outreach_count = 0;
  if (hubspotIds.length > 0) {
    const { data: outreach } = await db
      .from("outreach_log")
      .select("hubspot_id")
      .eq("user_id", user.id)
      .in("hubspot_id", hubspotIds);
    outreach_count = outreach?.length ?? 0;
  }

  const response: WatchCompanyDetailResponse = {
    company,
    prospects,
    briefs,
    signals_30d,
    outreach_count,
  };

  return NextResponse.json(response);
}
