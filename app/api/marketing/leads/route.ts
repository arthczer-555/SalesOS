import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { rematchHubspotForLead } from "@/lib/lead-analysis";
import { resolveMentionsInText, type SlackUser } from "@/lib/slack-leads";
import type {
  LeadDealScoreSummary,
  LeadValidationStatus,
} from "@/lib/marketing-types";
import type { DealScore } from "@/lib/deal-scoring";

// Module-level cache for Slack user lookups: avoids re-fetching the same user
// on every leads request. Cleared on cold start — names rarely change and the
// worst case is one extra users.info call.
const SLACK_USER_CACHE = new Map<string, SlackUser | null>();

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEADS_SINCE = "2025-01-01T00:00:00Z";
const REMATCH_CAP = 30;
const VALID_STATUSES: LeadValidationStatus[] = ["pending", "validated", "rejected"];
const VALID_FILTERS = [
  "all",
  "with_deal",
  "without_deal",
  "with_lead",
  "without_lead",
  "with_contact",
] as const;
type StatusFilter = LeadValidationStatus | "all";
type AnalysisFilter = (typeof VALID_FILTERS)[number];

const LEAD_SELECT = `
  id, slack_ts, slack_permalink, author_name, text, files, posted_at,
  validation_status, validated_by, validated_at,
  last_analysis_id, analysis_status, analyzed_at,
  analysis:lead_analyses!leads_last_analysis_id_fkey (
    id, lead_id, status, extracted_email, extracted_name, extracted_company,
    extracted_source, extraction_confidence, extraction_notes,
    hubspot_contact_id, hubspot_deal_id, match_strategy,
    contact_email, contact_name, contact_lifecyclestage, contact_hs_lead_status,
    contact_owner_id, contact_owner_name,
    hubspot_lead_id, hubspot_lead_name, hubspot_lead_pipeline_id,
    hubspot_lead_stage_id, hubspot_lead_stage_label,
    hubspot_lead_owner_id, hubspot_lead_owner_name,
    deal_name, deal_stage, deal_stage_label, deal_amount, deal_close_date,
    deal_owner_id, deal_owner_name, deal_is_closed, deal_is_closed_won,
    time_to_deal_seconds, time_to_close_seconds,
    error_message, created_at, updated_at
  )
`;
// Legacy select used as a fallback when the contact_* / hubspot_lead_*
// migrations haven't been applied yet.
const LEAD_SELECT_LEGACY = `
  id, slack_ts, slack_permalink, author_name, text, files, posted_at,
  validation_status, validated_by, validated_at,
  last_analysis_id, analysis_status, analyzed_at,
  analysis:lead_analyses!leads_last_analysis_id_fkey (
    id, lead_id, status, extracted_email, extracted_name, extracted_company,
    extraction_confidence, extraction_notes,
    hubspot_contact_id, hubspot_deal_id, match_strategy,
    deal_name, deal_stage, deal_stage_label, deal_amount, deal_close_date,
    deal_owner_id, deal_owner_name, deal_is_closed, deal_is_closed_won,
    time_to_deal_seconds, time_to_close_seconds,
    error_message, created_at, updated_at
  )
`;

function isValidStatus(s: string): s is LeadValidationStatus {
  return (VALID_STATUSES as string[]).includes(s);
}

function isValidFilter(s: string): s is AnalysisFilter {
  return (VALID_FILTERS as readonly string[]).includes(s);
}

interface LeadWithAnalysisRow {
  id: string;
  analysis_status: string | null;
  analysis: {
    hubspot_deal_id: string | null;
    hubspot_lead_id?: string | null;
    hubspot_contact_id?: string | null;
    [k: string]: unknown;
  } | null;
}

function matchesFilter(row: LeadWithAnalysisRow, filter: AnalysisFilter): boolean {
  const a = row.analysis;
  switch (filter) {
    case "with_deal":
      return !!a && !!a.hubspot_deal_id;
    case "without_deal":
      return !a || !a.hubspot_deal_id;
    case "with_lead":
      return !!a && !!a.hubspot_lead_id;
    case "without_lead":
      return !a || !a.hubspot_lead_id;
    case "with_contact":
      return !!a && !!a.hubspot_contact_id;
    default:
      return true;
  }
}

async function hydrateLeadMentions<T>(rows: T[]): Promise<T[]> {
  if (!process.env.SLACK_BOT_TOKEN) return rows;
  return Promise.all(
    rows.map(async (r) => {
      const text = (r as { text?: string | null }).text;
      if (!text || !text.includes("<@")) return r;
      const resolved = await resolveMentionsInText(text, SLACK_USER_CACHE);
      return resolved === text ? r : { ...r, text: resolved };
    }),
  );
}

async function attachDealScores<T extends LeadWithAnalysisRow>(rows: T[]): Promise<T[]> {
  const dealIds = Array.from(
    new Set(
      rows
        .map((r) => r.analysis?.hubspot_deal_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  if (dealIds.length === 0) return rows;

  const { data: scores, error } = await db
    .from("deal_scores")
    .select("deal_id, score, next_action, scored_at")
    .in("deal_id", dealIds);

  if (error || !scores) return rows;

  const byDealId = new Map<string, LeadDealScoreSummary>();
  for (const row of scores as Array<{
    deal_id: string;
    score: DealScore | null;
    next_action: string | null;
    scored_at: string | null;
  }>) {
    if (!row.score) continue;
    byDealId.set(row.deal_id, {
      total: row.score.total,
      reliability: row.score.reliability,
      scored_at: row.scored_at,
      next_action: row.next_action,
    });
  }

  return rows.map((r) => {
    const dealId = r.analysis?.hubspot_deal_id;
    if (!dealId || !r.analysis) return r;
    const summary = byDealId.get(dealId) ?? null;
    return { ...r, analysis: { ...r.analysis, deal_score: summary } };
  });
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const status: StatusFilter =
    statusParam === "all" || isValidStatus(statusParam) ? (statusParam as StatusFilter) : "pending";

  const filterParam = req.nextUrl.searchParams.get("filter") ?? "all";
  const analysis: AnalysisFilter = isValidFilter(filterParam) ? filterParam : "all";

  function buildListQuery(useLegacy: boolean) {
    let q = db
      .from("leads")
      .select(useLegacy ? LEAD_SELECT_LEGACY : LEAD_SELECT)
      .gte("posted_at", LEADS_SINCE)
      .order("posted_at", { ascending: false });
    if (status !== "all") q = q.eq("validation_status", status);
    return q;
  }

  // Counts on validated leads, joined to lead_analyses via last_analysis_id.
  // !inner makes the join exclude leads whose analysis row is missing — this
  // matters for "with_deal/with_lead"; for the negated buckets we derive the
  // count from totalValidated minus the positive count.
  const [
    listResInitial,
    pendingRes,
    validatedRes,
    rejectedRes,
    validatedWithDealRes,
    validatedWithLeadRes,
    validatedWithContactRes,
  ] = await Promise.all([
    buildListQuery(false),
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("validation_status", "pending")
      .gte("posted_at", LEADS_SINCE),
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("validation_status", "validated")
      .gte("posted_at", LEADS_SINCE),
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("validation_status", "rejected")
      .gte("posted_at", LEADS_SINCE),
    db
      .from("leads")
      .select(
        "id, analysis:lead_analyses!leads_last_analysis_id_fkey!inner(id)",
        { count: "exact", head: true },
      )
      .eq("validation_status", "validated")
      .gte("posted_at", LEADS_SINCE)
      .not("analysis.hubspot_deal_id", "is", null),
    db
      .from("leads")
      .select(
        "id, analysis:lead_analyses!leads_last_analysis_id_fkey!inner(id)",
        { count: "exact", head: true },
      )
      .eq("validation_status", "validated")
      .gte("posted_at", LEADS_SINCE)
      .not("analysis.hubspot_lead_id", "is", null),
    db
      .from("leads")
      .select(
        "id, analysis:lead_analyses!leads_last_analysis_id_fkey!inner(id)",
        { count: "exact", head: true },
      )
      .eq("validation_status", "validated")
      .gte("posted_at", LEADS_SINCE)
      .not("analysis.hubspot_contact_id", "is", null),
  ]);

  // If the list query failed because the contact_* columns from the
  // `lead_analyses_contact_stage` migration aren't applied yet, retry without
  // them so the page still renders.
  let listRes = listResInitial;
  if (listRes.error) {
    const fallback = await buildListQuery(true);
    if (!fallback.error) listRes = fallback;
  }

  if (listRes.error) {
    return NextResponse.json(
      {
        error: listRes.error.message,
        leads: [],
        counts: {
          pending: 0,
          validated: 0,
          rejected: 0,
          validatedWithDeal: 0,
          validatedWithoutDeal: 0,
          validatedWithLead: 0,
          validatedWithoutLead: 0,
          validatedWithContact: 0,
        },
      },
      { status: 500 },
    );
  }

  const validatedTotal = validatedRes.count ?? 0;
  const validatedWithDeal = validatedWithDealRes.count ?? 0;
  const validatedWithLead = validatedWithLeadRes.count ?? 0;
  const validatedWithContact = validatedWithContactRes.count ?? 0;
  const counts = {
    pending: pendingRes.count ?? 0,
    validated: validatedTotal,
    rejected: rejectedRes.count ?? 0,
    validatedWithDeal,
    validatedWithoutDeal: Math.max(0, validatedTotal - validatedWithDeal),
    validatedWithLead,
    // "Without lead" includes validated leads with an analysis row that has
    // no HubSpot Lead-object match AND validated leads that haven't been
    // analyzed yet.
    validatedWithoutLead: Math.max(0, validatedTotal - validatedWithLead),
    validatedWithContact,
  };

  const initialLeads = (listRes.data ?? []) as Array<{ id: string; analysis_status: string | null }>;

  // Lazy re-match: for leads currently no_match / error, retry HubSpot lookup
  // (deal may have been created since last analysis). Capped + parallel.
  const candidates = initialLeads
    .filter((l) => l.analysis_status === "no_match" || l.analysis_status === "error")
    .slice(0, REMATCH_CAP);

  if (candidates.length > 0) {
    await Promise.allSettled(candidates.map((l) => rematchHubspotForLead(l.id)));
    let refreshed = await buildListQuery(false);
    if (refreshed.error) {
      const legacy = await buildListQuery(true);
      if (!legacy.error) refreshed = legacy;
    }
    if (!refreshed.error && refreshed.data) {
      const enriched = await attachDealScores(
        refreshed.data as unknown as LeadWithAnalysisRow[],
      );
      const hydrated = await hydrateLeadMentions(enriched);
      const filtered = analysis === "all"
        ? hydrated
        : hydrated.filter((l) => matchesFilter(l, analysis));
      return NextResponse.json({ leads: filtered, counts });
    }
  }

  const enriched = await attachDealScores(
    (listRes.data ?? []) as unknown as LeadWithAnalysisRow[],
  );
  const hydrated = await hydrateLeadMentions(enriched);
  const filtered = analysis === "all"
    ? hydrated
    : hydrated.filter((l) => matchesFilter(l, analysis));
  return NextResponse.json({ leads: filtered, counts });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, status } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!status || !["validated", "rejected", "pending"].includes(status)) {
    return NextResponse.json(
      { error: "status must be validated, rejected or pending" },
      { status: 400 },
    );
  }

  const isTerminal = status === "validated" || status === "rejected";
  const { data, error } = await db
    .from("leads")
    .update({
      validation_status: status,
      validated_by: isTerminal ? user.id : null,
      validated_at: isTerminal ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id, validation_status, validated_by, validated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead: data });
}
