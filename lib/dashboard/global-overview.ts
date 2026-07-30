// ────────────────────────────────────────────────────────────────────────
// Vue globale (dashboard admin) : les chiffres de l'entreprise, pas ceux d'un
// individu. Objectifs et facturé par trimestre, répartition par sales, et
// pipeline ouvert en euros.
//
// Tout vient de sources déjà en place : les snapshots `ae_activity_snapshots`
// (donc le Sheet revenue, déjà parsé) et une requête HubSpot légère pour le
// pipeline. Aucun nouveau parsing.
//
// Convention de somme, importante : le TOTAL entreprise = New + Renew (AM).
// Le flux CSM porte le MÊME revenu que le Renew, vu côté delivery — l'ajouter
// le compterait deux fois. C'est la convention du Sheet lui-même
// (1 644 363 € = 780 752 € de New + 863 611 € de Renew).
// ────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { hubspotSearchAll } from "@/lib/hubspot";
import { fetchSalesPipeline } from "@/lib/ae-activity/fetch-hubspot";
import { isNurtureLabel } from "@/lib/deals/stages";
import type { QuarterAmount, RepSnapshot } from "@/lib/ae-activity/types";

export type RepRevenueLine = {
  ownerId: string;
  name: string;
  accent: string;
  roles: string[];
  newBilled: number | null;
  newTarget: number | null;
  renewBilled: number | null;
  renewTarget: number | null;
  csmBilled: number | null;
  csmTarget: number | null;
  /** New + Renew : ce que la personne pèse dans le total entreprise. */
  totalBilled: number;
  totalTarget: number;
};

export type GlobalOverview = {
  year: number;
  /** Facturé et objectif de l'entreprise, par trimestre puis en cumul annuel. */
  quarters: QuarterAmount[];
  totalBilled: number;
  totalTarget: number;
  newBilled: number;
  newTarget: number;
  renewBilled: number;
  renewTarget: number;
  reps: RepRevenueLine[];
  /** Pipeline ouvert du pipeline sales, nurture exclu. */
  openPipeline: number | null;
  openDeals: number | null;
  wonThisYear: number;
  lostThisYear: number;
  refreshedAt: string | null;
  warnings: string[];
};

const QUARTERS: QuarterAmount["quarter"][] = ["Q1", "Q2", "Q3", "Q4"];

function sumQuarters(streams: Array<QuarterAmount[]>): QuarterAmount[] {
  const acc = new Map<string, { target: number | null; billed: number | null }>();
  for (const list of streams) {
    for (const q of list) {
      const cur = acc.get(q.quarter) ?? { target: null, billed: null };
      if (q.target != null) cur.target = (cur.target ?? 0) + q.target;
      if (q.billed != null) cur.billed = (cur.billed ?? 0) + q.billed;
      acc.set(q.quarter, cur);
    }
  }
  return QUARTERS.filter((q) => acc.has(q)).map((q) => ({ quarter: q, ...acc.get(q)! }));
}

/** Pipeline ouvert en euros, hors nurture. Requête légère et isolée. */
async function fetchOpenPipeline(): Promise<{ amount: number | null; count: number | null }> {
  try {
    const { pipelineId, stages } = await fetchSalesPipeline();
    const nurtureIds = new Set(stages.filter((s) => isNurtureLabel(s.label)).map((s) => s.id));
    const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string> }>(
      "deals",
      {
        properties: ["amount", "dealstage"],
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              ...(pipelineId ? [{ propertyName: "pipeline", operator: "EQ", value: pipelineId }] : []),
            ],
          },
        ],
      },
      2000,
    );
    let amount = 0;
    let count = 0;
    for (const r of rows) {
      if (nurtureIds.has(r.properties?.dealstage ?? "")) continue;
      const v = Number(r.properties?.amount);
      if (Number.isFinite(v)) amount += v;
      count++;
    }
    return { amount, count };
  } catch {
    return { amount: null, count: null };
  }
}

export async function buildGlobalOverview(): Promise<GlobalOverview> {
  const warnings: string[] = [];
  const year = new Date().getUTCFullYear();

  const [{ data: rows }, pipeline] = await Promise.all([
    db.from("ae_activity_snapshots").select("payload, refreshed_at").order("rep_name"),
    fetchOpenPipeline(),
  ]);
  if (pipeline.amount == null) warnings.push("pipeline");

  const snapshots = (rows ?? []).map((r) => (r as { payload: RepSnapshot }).payload).filter(Boolean);
  const refreshedAt = (rows ?? []).reduce<string | null>((max, r) => {
    const ts = (r as { refreshed_at: string | null }).refreshed_at;
    return ts && (!max || ts > max) ? ts : max;
  }, null);
  if (snapshots.length === 0) warnings.push("snapshots");

  const reps: RepRevenueLine[] = snapshots.map((s) => {
    const newBilled = s.revenue.newBiz.billed;
    const newTarget = s.revenue.newBiz.target;
    const renewBilled = s.revenue.renew.billed;
    const renewTarget = s.revenue.renew.target;
    return {
      ownerId: s.repOwnerId,
      name: s.repName,
      accent: s.accent,
      roles: s.roles ?? [],
      newBilled,
      newTarget,
      renewBilled,
      renewTarget,
      csmBilled: s.revenue.csmRenew.billed,
      csmTarget: s.revenue.csmRenew.target,
      totalBilled: (newBilled ?? 0) + (renewBilled ?? 0),
      totalTarget: (newTarget ?? 0) + (renewTarget ?? 0),
    };
  });

  const sum = (get: (r: RepRevenueLine) => number | null): number =>
    reps.reduce((acc, r) => acc + (get(r) ?? 0), 0);

  const quarters = sumQuarters([
    ...snapshots.map((s) => s.revenue.newBiz.quarters),
    ...snapshots.map((s) => s.revenue.renew.quarters),
  ]);

  let wonThisYear = 0;
  let lostThisYear = 0;
  for (const s of snapshots) {
    const bucket = (s.byGranularity.year ?? []).find((b) => b.key.startsWith(String(year)));
    wonThisYear += bucket?.closedWon ?? 0;
    lostThisYear += bucket?.closedLost ?? 0;
  }

  return {
    year,
    quarters,
    totalBilled: sum((r) => r.totalBilled),
    totalTarget: sum((r) => r.totalTarget),
    newBilled: sum((r) => r.newBilled),
    newTarget: sum((r) => r.newTarget),
    renewBilled: sum((r) => r.renewBilled),
    renewTarget: sum((r) => r.renewTarget),
    // Un CSM pur ne porte ni New ni Renew (AM) : sa ligne serait un 0 €/0 €
    // trompeur, alors que son Renew est déjà compté chez l'AM.
    reps: reps
      .filter((r) => r.totalBilled > 0 || r.totalTarget > 0)
      .sort((a, b) => b.totalBilled - a.totalBilled),
    openPipeline: pipeline.amount,
    openDeals: pipeline.count,
    wonThisYear,
    lostThisYear,
    refreshedAt,
    warnings,
  };
}
