// ────────────────────────────────────────────────────────────────────────
// Deal Review — construction du dataset de revue de pipeline (admin).
//
// Volumétrie faible (~230 deals ouverts, ~100 clos sur l'année) : tout est
// fetché en live à chaque appel, pas de snapshot ni de cron. Chaque source est
// best-effort : un échec pousse un warning et laisse le reste s'afficher.
//
// Métrique centrale : `num_contacted_notes` ("Number of times contacted"),
// c'est-à-dire les calls, emails commerciaux, meetings, messages LinkedIn, SMS
// et WhatsApp LOGGÉS dans HubSpot. Tout ce qui se passe hors CRM est invisible,
// la limite est affichée dans l'UI plutôt que masquée.
// ────────────────────────────────────────────────────────────────────────

import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";
import { fetchSalesPipeline } from "@/lib/ae-activity/fetch-hubspot";
import { listSalesReps } from "@/lib/ae-activity/reps";
import { isNurtureLabel } from "@/lib/deals/stages";
import { repAccent } from "@/lib/design/tokens";
import { db } from "@/lib/db";
import type { DealScore } from "@/lib/deal-scoring";
import {
  MIN_CLOSED_SAMPLE,
  MIN_STAGE_SAMPLE,
  MIN_WON_SAMPLE,
  STALE_CONTACT_DAYS,
  type ClosedDealRow,
  type DealReviewResponse,
  type DealReviewTotals,
  type DealRow,
  type RepSummary,
  type StageBenchmark,
  type WonBenchmark,
} from "./types";

type HsRow = { id: string; properties?: Record<string, string> };

const OPEN_DEAL_PROPS = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "createdate",
  "hubspot_owner_id",
  "notes_last_contacted",
  "num_associated_contacts",
  "num_contacted_notes",
  "num_notes",
  "hs_v2_date_entered_current_stage",
  "hs_is_stalled",
  "notes_next_activity_date",
  "hs_next_step",
];

const CLOSED_DEAL_PROPS = [
  "dealname",
  "hubspot_owner_id",
  "hs_is_closed_won",
  "days_to_close",
  "num_contacted_notes",
  "amount",
  "closedate",
  "createdate",
];

/* ── Helpers purs ─────────────────────────────────────────────────────── */

/** Médiane d'une liste de nombres. `null` si la liste est vide. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function num(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Nombre de jours entiers écoulés depuis une date HubSpot. */
function daysSince(raw: string | undefined, now: number): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 864e5));
}

/** Date de closing en ms, 0 si absente : les deals sans date finissent en bas. */
function closedAtMs(row: ClosedDealRow): number {
  const ms = row.closedate ? Date.parse(row.closedate) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

function startOfPeriod(): string {
  return process.env.AE_ACTIVITY_START || "2026-01-01";
}

/**
 * Médiane de touch points par étape, calculée sur les deals ouverts hors
 * nurture. Publiée seulement si l'étape a au moins MIN_STAGE_SAMPLE deals :
 * en dessous, la médiane n'est pas représentative (Negotiation n'a souvent
 * qu'un seul deal ouvert).
 */
export function buildStageBenchmarks(
  deals: DealRow[],
  stages: Array<{ id: string; label: string }>,
): StageBenchmark[] {
  return stages.map((s, order) => {
    const rows = deals.filter((d) => d.stageId === s.id && !d.isNurture);
    const pipeline = rows.reduce((sum, d) => sum + (d.amount ?? 0), 0);
    const med = median(rows.map((d) => d.touchPoints));
    return {
      stageId: s.id,
      stageLabel: s.label,
      order,
      openDeals: rows.length,
      pipeline,
      medianTouchPoints: rows.length >= MIN_STAGE_SAMPLE ? med : null,
    };
  });
}

/** Seules les colonnes utiles aux agrégats ; `ClosedDealRow` en est un sur-ensemble. */
type ClosedDeal = {
  ownerId: string;
  won: boolean;
  daysToClose: number | null;
  touchPoints: number | null;
};

/**
 * Agrégat par owner. Les deals nurture sont exclus des compteurs (mais restent
 * dans `deals[]` pour le toggle client), afin que les médianes et le pipeline €
 * décrivent le pipeline réellement travaillé.
 */
export function buildRepSummaries(
  deals: DealRow[],
  closed: ClosedDeal[],
  ownerNames: Map<string, string>,
  salesOwnerIds: Set<string>,
): RepSummary[] {
  const ownerIds = new Set<string>([
    ...deals.filter((d) => !d.isNurture).map((d) => d.ownerId),
    ...closed.map((c) => c.ownerId),
  ]);
  ownerIds.delete("");

  const summaries = [...ownerIds].map((ownerId) => {
    const own = deals.filter((d) => d.ownerId === ownerId && !d.isNurture);
    const ownClosed = closed.filter((c) => c.ownerId === ownerId);
    const won = ownClosed.filter((c) => c.won);
    const lost = ownClosed.filter((c) => !c.won);
    const name = ownerNames.get(ownerId) || "Inconnu";

    return {
      ownerId,
      ownerName: name,
      accent: repAccent(name),
      isSalesUser: salesOwnerIds.has(ownerId),
      openDeals: own.length,
      pipeline: own.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      medianTouchPoints: median(own.map((d) => d.touchPoints)),
      stalledCount: own.filter((d) => d.isStalled).length,
      noNextActivityCount: own.filter((d) => !d.nextActivityAt).length,
      staleContactCount: own.filter(
        (d) => d.daysSinceContact == null || d.daysSinceContact > STALE_CONTACT_DAYS,
      ).length,
      closedWon: won.length,
      closedLost: lost.length,
      // Un win rate sur 2 deals clos ne veut rien dire et serait lu comme une
      // performance. Les compteurs bruts restent exposés (closedWon/closedLost)
      // pour que l'UI puisse les afficher en infobulle.
      winRate:
        ownClosed.length >= MIN_CLOSED_SAMPLE
          ? Math.round((won.length / ownClosed.length) * 100)
          : null,
      medianDaysToClose:
        won.length >= MIN_WON_SAMPLE
          ? median(won.map((c) => c.daysToClose).filter((v): v is number => v != null))
          : null,
      medianTouchesToClose:
        won.length >= MIN_WON_SAMPLE
          ? median(won.map((c) => c.touchPoints).filter((v): v is number => v != null))
          : null,
    };
  });

  // Les AE du roster d'abord, puis par nombre de deals ouverts décroissant.
  return summaries.sort((a, b) => {
    if (a.isSalesUser !== b.isSalesUser) return a.isSalesUser ? -1 : 1;
    if (b.openDeals !== a.openDeals) return b.openDeals - a.openDeals;
    return a.ownerName.localeCompare(b.ownerName);
  });
}

/* ── Fetchs ───────────────────────────────────────────────────────────── */

async function fetchOwnerNames(): Promise<Map<string, string>> {
  const res = await hubspotFetch<{
    results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
  }>("/crm/v3/owners?limit=100");
  const map = new Map<string, string>();
  for (const o of res.results ?? []) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
    map.set(o.id, name || o.email || "Inconnu");
  }
  return map;
}

/** Score IA /100 depuis le cache Supabase, comme /api/deals/list. */
async function fetchScores(
  dealIds: string[],
): Promise<Map<string, { score: number | null; reliability: number | null }>> {
  const out = new Map<string, { score: number | null; reliability: number | null }>();
  if (dealIds.length === 0 || !process.env.SUPABASE_URL) return out;
  const { data, error } = await db
    .from("deal_scores")
    .select("deal_id, score")
    .in("deal_id", dealIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Array<{ deal_id: string; score: DealScore | null }>) {
    out.set(row.deal_id, {
      score: row.score?.total ?? null,
      reliability: row.score?.reliability ?? null,
    });
  }
  return out;
}

/** Meetings Claap analysés par deal : nombre + note moyenne /10. */
async function fetchClaap(
  dealIds: string[],
): Promise<Map<string, { calls: number; avgScore: number | null }>> {
  const out = new Map<string, { calls: number; avgScore: number | null }>();
  if (dealIds.length === 0 || !process.env.SUPABASE_URL) return out;
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select("hubspot_deal_id, score_global")
    .in("hubspot_deal_id", dealIds)
    .eq("status", "done");
  if (error) throw new Error(error.message);

  const scoresByDeal = new Map<string, number[]>();
  for (const row of (data ?? []) as Array<{
    hubspot_deal_id: string | null;
    score_global: number | null;
  }>) {
    const id = row.hubspot_deal_id;
    if (!id) continue;
    const prev = out.get(id) ?? { calls: 0, avgScore: null };
    out.set(id, { calls: prev.calls + 1, avgScore: null });
    if (row.score_global != null) {
      const list = scoresByDeal.get(id) ?? [];
      list.push(Number(row.score_global));
      scoresByDeal.set(id, list);
    }
  }
  for (const [id, entry] of out) {
    const list = scoresByDeal.get(id);
    if (list && list.length > 0) {
      entry.avgScore = list.reduce((a, b) => a + b, 0) / list.length;
    }
  }
  return out;
}

/* ── Point d'entrée ───────────────────────────────────────────────────── */

export async function buildDealReview(): Promise<DealReviewResponse> {
  const now = Date.now();
  const warnings: string[] = [];
  const periodStart = startOfPeriod();
  const periodStartMs = String(Date.parse(`${periodStart}T00:00:00Z`));

  const { pipelineId, stages } = await fetchSalesPipeline();
  if (!pipelineId) warnings.push("pipeline");

  // Étapes ouvertes du pipeline sales, dans l'ordre d'affichage.
  const openStages = stages.filter((s) => !s.isClosed);
  const stageById = new Map(openStages.map((s, order) => [s.id, { ...s, order }]));

  const openFilters: Array<{ propertyName: string; operator: string; value?: string }> = [
    { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
  ];
  if (pipelineId) {
    openFilters.push({ propertyName: "pipeline", operator: "EQ", value: pipelineId });
  }

  const [openResult, closedResult, ownersResult, repsResult] = await Promise.allSettled([
    // hubspotSearchAll pagine : indispensable, le pipeline sales dépasse les
    // 200 résultats d'une page unique.
    hubspotSearchAll<HsRow>(
      "deals",
      {
        properties: OPEN_DEAL_PROPS,
        filterGroups: [{ filters: openFilters }],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      },
      1000,
    ),
    // Convention "won" identique à lib/ae-activity/fetch-hubspot.ts
    // (hs_is_closed_won), mais restreinte au pipeline sales : cette page est
    // une revue de pipeline sales, un renouvellement clos côté Customer
    // Success n'a rien à faire dans le win rate d'un AE.
    hubspotSearchAll<HsRow>(
      "deals",
      {
        properties: CLOSED_DEAL_PROPS,
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_is_closed", operator: "EQ", value: "true" },
              { propertyName: "closedate", operator: "GTE", value: periodStartMs },
              ...(pipelineId
                ? [{ propertyName: "pipeline", operator: "EQ", value: pipelineId }]
                : []),
            ],
          },
        ],
      },
      2000,
    ),
    fetchOwnerNames(),
    listSalesReps(),
  ]);

  if (openResult.status === "rejected") warnings.push("deals_open");
  if (closedResult.status === "rejected") warnings.push("deals_closed");
  if (ownersResult.status === "rejected") warnings.push("owners");

  const openRows = openResult.status === "fulfilled" ? openResult.value : [];
  const closedRows = closedResult.status === "fulfilled" ? closedResult.value : [];
  const ownerNames = ownersResult.status === "fulfilled" ? ownersResult.value : new Map<string, string>();
  const reps = repsResult.status === "fulfilled" ? repsResult.value : [];

  // Le roster `users.is_sales` prime sur les prénoms HubSpot pour l'affichage.
  const salesOwnerIds = new Set(reps.map((r) => r.ownerId));
  for (const rep of reps) ownerNames.set(rep.ownerId, rep.name);

  const dealIds = openRows.map((r) => r.id);
  const [scoresResult, claapResult] = await Promise.allSettled([
    fetchScores(dealIds),
    fetchClaap(dealIds),
  ]);
  if (scoresResult.status === "rejected") warnings.push("scores");
  if (claapResult.status === "rejected") warnings.push("claap");
  const scores =
    scoresResult.status === "fulfilled"
      ? scoresResult.value
      : new Map<string, { score: number | null; reliability: number | null }>();
  const claap =
    claapResult.status === "fulfilled"
      ? claapResult.value
      : new Map<string, { calls: number; avgScore: number | null }>();

  const deals: DealRow[] = openRows.map((row) => {
    const p = row.properties ?? {};
    const stage = stageById.get(p.dealstage ?? "");
    const stageLabel = stage?.label ?? p.dealstage ?? "—";
    const ownerId = p.hubspot_owner_id ?? "";
    const ownerName = ownerNames.get(ownerId) || "Unassigned";
    const scoreEntry = scores.get(row.id);
    const claapEntry = claap.get(row.id);

    return {
      id: row.id,
      dealname: p.dealname || "Untitled deal",
      stageId: p.dealstage ?? "",
      stageLabel,
      stageOrder: stage?.order ?? 999,
      isNurture: isNurtureLabel(stageLabel),
      amount: num(p.amount),
      ownerId,
      ownerName,
      ownerAccent: repAccent(ownerName),
      score: scoreEntry?.score ?? null,
      reliability: scoreEntry?.reliability ?? null,
      touchPoints: num(p.num_contacted_notes) ?? 0,
      salesActivities: num(p.num_notes) ?? 0,
      numContacts: num(p.num_associated_contacts) ?? 0,
      claapCalls: claapEntry?.calls ?? 0,
      claapAvgScore: claapEntry?.avgScore ?? null,
      daysInStage: daysSince(p.hs_v2_date_entered_current_stage, now),
      daysSinceContact: daysSince(p.notes_last_contacted, now),
      isStalled: p.hs_is_stalled === "true",
      nextActivityAt: p.notes_next_activity_date || null,
      nextStep: p.hs_next_step || null,
      createdate: p.createdate || null,
      closedate: p.closedate || null,
    };
  });

  const closedDeals: ClosedDealRow[] = closedRows.map((row) => {
    const p = row.properties ?? {};
    const ownerId = p.hubspot_owner_id ?? "";
    const ownerName = ownerNames.get(ownerId) || "Unassigned";
    return {
      id: row.id,
      dealname: p.dealname || "Untitled deal",
      won: p.hs_is_closed_won === "true",
      ownerId,
      ownerName,
      ownerAccent: repAccent(ownerName),
      amount: num(p.amount),
      closedate: p.closedate || null,
      createdate: p.createdate || null,
      daysToClose: num(p.days_to_close),
      touchPoints: num(p.num_contacted_notes),
    };
  });
  const closed: ClosedDeal[] = closedDeals;

  const stageBenchmarks = buildStageBenchmarks(deals, openStages);
  const repSummaries = buildRepSummaries(deals, closed, ownerNames, salesOwnerIds);

  const active = deals.filter((d) => !d.isNurture);
  const wonAll = closed.filter((c) => c.won);
  const lostAll = closed.filter((c) => !c.won);

  const totals: DealReviewTotals = {
    openDeals: active.length,
    pipeline: active.reduce((sum, d) => sum + (d.amount ?? 0), 0),
    medianTouchPoints: median(active.map((d) => d.touchPoints)),
    stalledCount: active.filter((d) => d.isStalled).length,
    noNextActivityCount: active.filter((d) => !d.nextActivityAt).length,
    staleContactCount: active.filter(
      (d) => d.daysSinceContact == null || d.daysSinceContact > STALE_CONTACT_DAYS,
    ).length,
    closedWon: wonAll.length,
    closedLost: lostAll.length,
    winRate: closed.length > 0 ? Math.round((wonAll.length / closed.length) * 100) : null,
  };

  const wonBenchmark: WonBenchmark = {
    medianTouchPoints: median(
      wonAll.map((c) => c.touchPoints).filter((v): v is number => v != null),
    ),
    medianDaysToClose: median(
      wonAll.map((c) => c.daysToClose).filter((v): v is number => v != null),
    ),
    sample: wonAll.length,
    lostMedianTouchPoints: median(
      lostAll.map((c) => c.touchPoints).filter((v): v is number => v != null),
    ),
    lostSample: lostAll.length,
  };

  return {
    deals,
    // Les plus récents d'abord : c'est l'ordre de lecture attendu quand on
    // ouvre la liste depuis le KPI win rate.
    closedDeals: [...closedDeals].sort((a, b) => closedAtMs(b) - closedAtMs(a)),
    stages: stageBenchmarks,
    reps: repSummaries,
    totals,
    wonBenchmark,
    periodStart,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}
