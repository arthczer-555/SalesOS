import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type {
  LeadSourceBucket,
  SalesPerformanceRow,
} from "@/lib/marketing-types";

export const dynamic = "force-dynamic";

const LEADS_SINCE = "2025-01-01T00:00:00Z";

interface LeadRow {
  id: string;
  validation_status: string;
  validated_at: string | null;
  posted_at: string;
  last_analysis_id: string | null;
}

interface AnalysisRow {
  id: string;
  hubspot_deal_id: string | null;
  extracted_source: string | null;
  deal_amount: number | null;
  deal_stage_label: string | null;
  deal_is_closed: boolean | null;
  deal_is_closed_won: boolean | null;
  deal_owner_id: string | null;
  deal_owner_name: string | null;
}

function isDiscoReached(a: AnalysisRow): boolean {
  if (!a.hubspot_deal_id) return false;
  if (a.deal_is_closed === true) return true;
  if (a.deal_stage_label && /disco/i.test(a.deal_stage_label)) return true;
  return false;
}

function normalizeSourceKey(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 86400000).toISOString();
  const from = fromParam ?? defaultFrom;
  const to = toParam ?? now.toISOString();

  const FULL_ANALYSES_SELECT =
    "id, hubspot_deal_id, extracted_source, deal_amount, deal_stage_label, deal_is_closed, deal_is_closed_won, deal_owner_id, deal_owner_name";
  // Fallback if the extracted_source migration hasn't been applied yet.
  const LEGACY_ANALYSES_SELECT =
    "id, hubspot_deal_id, deal_amount, deal_stage_label, deal_is_closed, deal_is_closed_won, deal_owner_id, deal_owner_name";

  const [leadsRes, analysesRes] = await Promise.all([
    db
      .from("leads")
      .select("id, validation_status, validated_at, posted_at, last_analysis_id")
      .gte("posted_at", LEADS_SINCE),
    db.from("lead_analyses").select(FULL_ANALYSES_SELECT),
  ]);

  let analyses: AnalysisRow[];
  if (analysesRes.error) {
    const fallback = await db.from("lead_analyses").select(LEGACY_ANALYSES_SELECT);
    if (fallback.error) {
      return NextResponse.json(
        { error: fallback.error.message ?? "DB error" },
        { status: 500 },
      );
    }
    analyses = (fallback.data ?? []).map((row) => ({
      ...(row as Omit<AnalysisRow, "extracted_source">),
      extracted_source: null,
    }));
  } else {
    analyses = (analysesRes.data ?? []) as AnalysisRow[];
  }

  if (leadsRes.error) {
    return NextResponse.json(
      { error: leadsRes.error.message ?? "DB error" },
      { status: 500 },
    );
  }

  const leads = (leadsRes.data ?? []) as LeadRow[];
  const analysisById = new Map<string, AnalysisRow>(analyses.map((a) => [a.id, a]));

  const inPeriod = (iso: string | null): boolean => {
    if (!iso) return false;
    return iso >= from && iso <= to;
  };

  const periodLeads = leads.filter((l) => inPeriod(l.validated_at ?? l.posted_at));
  const totalLeads = periodLeads.length;
  const validated = periodLeads.filter((l) => l.validation_status === "validated").length;

  let withDeal = 0;
  let disco = 0;
  let closedWon = 0;
  let closedLost = 0;
  let openPipelineAmount = 0;
  let closedLostAmount = 0;

  // Source buckets keyed by normalized lowercase. We keep the most frequent
  // original casing per key as the display label, so "LinkedIn"/"linkedin"
  // collapse to a single row while preserving the readable name.
  const sourceBuckets = new Map<
    string,
    { count: number; labels: Map<string, number> }
  >();

  interface SalesAcc {
    ownerId: string;
    ownerName: string;
    leadsCount: number;
    dealIds: Set<string>;
    wonCount: number;
    lostCount: number;
    openPipelineAmount: number;
    wonAmount: number;
  }
  const salesByOwner = new Map<string, SalesAcc>();

  for (const l of periodLeads) {
    if (l.validation_status !== "validated") continue;
    const a = l.last_analysis_id ? analysisById.get(l.last_analysis_id) : null;
    if (!a) continue;
    if (a.hubspot_deal_id) withDeal++;
    if (isDiscoReached(a)) disco++;
    if (a.deal_is_closed_won) closedWon++;
    if (a.deal_is_closed === true && a.deal_is_closed_won === false) {
      closedLost++;
      if (typeof a.deal_amount === "number") closedLostAmount += a.deal_amount;
    }
    if (a.hubspot_deal_id && a.deal_is_closed === false && typeof a.deal_amount === "number") {
      openPipelineAmount += a.deal_amount;
    }

    // Source aggregation
    const key = normalizeSourceKey(a.extracted_source);
    const displayRaw = a.extracted_source?.trim() ?? "";
    if (key) {
      const bucket = sourceBuckets.get(key) ?? { count: 0, labels: new Map<string, number>() };
      bucket.count++;
      if (displayRaw) {
        bucket.labels.set(displayRaw, (bucket.labels.get(displayRaw) ?? 0) + 1);
      }
      sourceBuckets.set(key, bucket);
    } else {
      const bucket = sourceBuckets.get("_unknown") ?? { count: 0, labels: new Map<string, number>() };
      bucket.count++;
      sourceBuckets.set("_unknown", bucket);
    }

    // Sales attribution (only when we have a HubSpot deal owner)
    if (a.deal_owner_id && a.hubspot_deal_id) {
      const ownerId = a.deal_owner_id;
      const ownerName = a.deal_owner_name || "Sans nom";
      const acc = salesByOwner.get(ownerId) ?? {
        ownerId,
        ownerName,
        leadsCount: 0,
        dealIds: new Set<string>(),
        wonCount: 0,
        lostCount: 0,
        openPipelineAmount: 0,
        wonAmount: 0,
      };
      acc.leadsCount++;
      acc.dealIds.add(a.hubspot_deal_id);
      if (a.deal_is_closed_won) {
        acc.wonCount++;
        if (typeof a.deal_amount === "number") acc.wonAmount += a.deal_amount;
      } else if (a.deal_is_closed === true) {
        acc.lostCount++;
      } else if (a.deal_is_closed === false && typeof a.deal_amount === "number") {
        acc.openPipelineAmount += a.deal_amount;
      }
      salesByOwner.set(ownerId, acc);
    }
  }

  const bySource: LeadSourceBucket[] = Array.from(sourceBuckets.entries())
    .map(([key, bucket]) => {
      if (key === "_unknown") return { source: "Inconnu", count: bucket.count };
      let topLabel = "";
      let topCount = -1;
      for (const [label, c] of bucket.labels) {
        if (c > topCount) {
          topLabel = label;
          topCount = c;
        }
      }
      return { source: topLabel || key, count: bucket.count };
    })
    .sort((a, b) => b.count - a.count);

  const bySales: SalesPerformanceRow[] = Array.from(salesByOwner.values())
    .map((acc) => ({
      ownerId: acc.ownerId,
      ownerName: acc.ownerName,
      leadsCount: acc.leadsCount,
      dealsCount: acc.dealIds.size,
      wonCount: acc.wonCount,
      lostCount: acc.lostCount,
      openPipelineAmount: acc.openPipelineAmount,
      wonAmount: acc.wonAmount,
      conversionPct: acc.leadsCount > 0 ? (acc.wonCount / acc.leadsCount) * 100 : 0,
    }))
    .sort((a, b) => b.leadsCount - a.leadsCount);

  return NextResponse.json({
    period: { from, to },
    funnel: {
      totalLeads,
      validated,
      withDeal,
      disco,
      closedWon,
      closedLost,
      bySource,
      bySales,
    },
    openPipelineAmount,
    closedLostAmount,
  });
}
