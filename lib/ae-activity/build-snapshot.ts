// ────────────────────────────────────────────────────────────────────────
// Orchestrateur du dashboard AE : recalcule le snapshot de chaque rep et le
// persiste dans ae_activity_snapshots (1 row/rep). Déclenché 1x/jour (cron
// 06:00 UTC), à l'ouverture d'un dashboard périmé, ou à la demande (bouton
// "Refresh"). Tout est recalculé à chaque passage.
//
// Pour chaque rep : activité HubSpot (REST) → buckets (4 granularités) +
// funnel + lost reasons, revenu/objectifs (Sheet Drive), meetings tenus
// (Claap), meetings déclarés (Slack), note Sales Coach. Les sources
// partagées (pipeline, dispositions, Sheet, Claap, Slack) sont fetchées une
// seule fois. Best-effort partout : un rep en échec n'empêche pas les autres.
// ────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import {
  GRANULARITIES,
  emptyRevenueStream,
  type AeActivityMeta,
  type AeActivityResponse,
  type RepSnapshot,
  type RevenuePerf,
} from "./types";
import { bucketize } from "./aggregate";
import {
  fetchDispositionLabelMap,
  fetchOwnerHubspot,
  fetchSalesPipelineStages,
  type OwnerHubspotContext,
} from "./fetch-hubspot";
import { listSalesReps } from "./reps";
import { fetchRevenueSheet, repKeyFromName } from "./revenue-sheet";
import { fetchClaapMeetingsHeld } from "./claap-meetings";
import { fetchSlackSelfBookedMeetings } from "./slack-meetings";
import { fetchMarketingLeads, buildLeadsFunnel } from "./leads";
import { buildCoaching } from "./coaching";

function startDay(): string {
  return process.env.AE_ACTIVITY_START || "2026-01-01";
}

function todayDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function setMeta(fields: Partial<{
  status: AeActivityMeta["status"];
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  rep_count: number | null;
}>): Promise<void> {
  try {
    await db.from("ae_activity_meta").update(fields).eq("id", 1);
  } catch (e) {
    console.warn("[ae-activity] setMeta failed:", e instanceof Error ? e.message : e);
  }
}

export type RefreshResult = { ok: boolean; repCount: number; error?: string };

export type RefreshOptions = {
  /**
   * Ne recalculer que ces reps (owner ids HubSpot). Sert au rafraîchissement à
   * la demande depuis le dashboard : un rep qui ouvre sa page ne doit pas
   * relancer les 8 autres. Le statut global (ae_activity_meta) et le nettoyage
   * des reps sortis de l'équipe restent réservés au refresh complet, sinon la
   * page AE Activity afficherait "running" en boucle.
   */
  ownerIds?: string[];
};

/**
 * Recalcule et persiste le snapshot des reps sales. Idempotent :
 * upsert par rep_owner_id + nettoyage des reps qui ne sont plus sales.
 */
export async function runAeActivityRefresh(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const start = startDay();
  const end = todayDay();
  const now = new Date().toISOString();
  const targeted = (opts.ownerIds ?? []).filter(Boolean);
  const isPartial = targeted.length > 0;

  if (!isPartial) {
    await setMeta({ status: "running", started_at: now, finished_at: null, error_message: null });
  }

  try {
    const allReps = await listSalesReps();
    const reps = isPartial ? allReps.filter((r) => targeted.includes(r.ownerId)) : allReps;
    if (reps.length === 0) {
      if (!isPartial) await setMeta({ status: "done", finished_at: new Date().toISOString(), rep_count: 0 });
      return { ok: true, repCount: 0 };
    }

    // Sources partagées (fetchées une seule fois pour tous les reps).
    const [stages, dispositionMap, revenueSheet, claapHeld, slackBooked, leads] = await Promise.all([
      fetchSalesPipelineStages(),
      fetchDispositionLabelMap(),
      fetchRevenueSheet(),
      fetchClaapMeetingsHeld(start),
      fetchSlackSelfBookedMeetings(start),
      fetchMarketingLeads(start),
    ]);

    const ctx: OwnerHubspotContext = { startDay: start, endDay: end, stages, dispositionMap, leads };
    const refreshedAt = new Date().toISOString();

    // Séquentiel : peu de reps, et on reste soft avec les quotas HubSpot/Claude.
    for (const rep of reps) {
      try {
        const hs = await fetchOwnerHubspot(rep.ownerId, ctx);

        const claapDays = claapHeld.get((rep.email ?? "").toLowerCase()) ?? [];
        // Slack : le map est keyé par email du posteur (fallback slack user id).
        const slackMeetings =
          slackBooked.get((rep.email ?? "").toLowerCase()) ??
          (rep.slackUserId ? slackBooked.get(rep.slackUserId) : undefined) ??
          [];
        const slackDays = slackMeetings.map((m) => m.day);

        // Leads marketing attribués au rep (owner du deal matché).
        const repLeads = leads.byOwner.get(rep.ownerId) ?? [];
        const leadDays = repLeads
          .map((l) => l.validatedDay)
          .filter((d): d is string => !!d);
        const leadsFunnel = buildLeadsFunnel(repLeads, stages);

        const byGranularity = Object.fromEntries(
          GRANULARITIES.map((g) => [g, bucketize(hs.raw, claapDays, slackDays, leadDays, g)]),
        ) as RepSnapshot["byGranularity"];

        const sheetKey = repKeyFromName(rep.name);
        const rr = revenueSheet.byRep.get(sheetKey);
        const revenue: RevenuePerf = rr
          ? { matched: true, sheetName: sheetKey, newBiz: rr.newBiz, renew: rr.renew, csmRenew: rr.csmRenew }
          : {
              matched: false,
              sheetName: null,
              newBiz: emptyRevenueStream(),
              renew: emptyRevenueStream(),
              csmRenew: emptyRevenueStream(),
            };

        const coaching = await buildCoaching(rep.userId, start);

        const dataWarnings = [...hs.warnings];
        if (!revenue.matched && !revenueSheet.ok) dataWarnings.push("revenue_sheet");

        const snapshot: RepSnapshot = {
          repOwnerId: rep.ownerId,
          repName: rep.name,
          repEmail: rep.email,
          roles: rep.roles,
          accent: rep.accent,
          byGranularity,
          funnel: hs.funnel,
          leadsFunnel,
          lostReasons: hs.lostReasons,
          revenue,
          coaching,
          slackMeetings: [...slackMeetings].sort((a, b) => b.ts.localeCompare(a.ts)),
          dataWarnings,
        };

        await db
          .from("ae_activity_snapshots")
          .upsert(
            {
              rep_owner_id: rep.ownerId,
              rep_name: rep.name,
              rep_email: rep.email,
              payload: snapshot,
              refreshed_at: refreshedAt,
            },
            { onConflict: "rep_owner_id" },
          );
      } catch (e) {
        console.error(`[ae-activity] rep ${rep.name} (${rep.ownerId}) failed:`, e instanceof Error ? e.message : e);
      }
    }

    if (isPartial) {
      return { ok: true, repCount: reps.length };
    }

    // Nettoyage : supprime les rows des reps qui ne sont plus sales.
    try {
      const currentIds = new Set(reps.map((r) => r.ownerId));
      const { data: existing } = await db.from("ae_activity_snapshots").select("rep_owner_id");
      const stale = (existing ?? [])
        .map((r) => (r as { rep_owner_id: string }).rep_owner_id)
        .filter((id) => !currentIds.has(id));
      if (stale.length > 0) {
        await db.from("ae_activity_snapshots").delete().in("rep_owner_id", stale);
      }
    } catch (e) {
      console.warn("[ae-activity] stale cleanup failed:", e instanceof Error ? e.message : e);
    }

    await setMeta({ status: "done", finished_at: new Date().toISOString(), rep_count: reps.length });
    return { ok: true, repCount: reps.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ae-activity] refresh failed:", error);
    await setMeta({ status: "error", finished_at: new Date().toISOString(), error_message: error.slice(0, 500) });
    return { ok: false, repCount: 0, error };
  }
}

/** Lecture du snapshot complet pour l'API/page. */
export async function readAeActivity(): Promise<AeActivityResponse> {
  const [{ data: rows }, { data: metaRow }] = await Promise.all([
    db.from("ae_activity_snapshots").select("payload, refreshed_at").order("rep_name", { ascending: true }),
    db.from("ae_activity_meta").select("status, started_at, finished_at, error_message, rep_count").eq("id", 1).maybeSingle(),
  ]);

  const reps = (rows ?? []).map((r) => (r as { payload: RepSnapshot }).payload);
  const refreshedAt = (rows ?? []).reduce<string | null>((max, r) => {
    const ts = (r as { refreshed_at: string | null }).refreshed_at;
    return ts && (!max || ts > max) ? ts : max;
  }, null);

  const meta: AeActivityMeta = {
    status: (metaRow?.status as AeActivityMeta["status"]) ?? "idle",
    startedAt: metaRow?.started_at ?? null,
    finishedAt: metaRow?.finished_at ?? null,
    errorMessage: metaRow?.error_message ?? null,
    repCount: metaRow?.rep_count ?? null,
  };

  return { reps, refreshedAt, meta };
}
