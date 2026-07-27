// Helpers d'affichage du Deal Review. Les formateurs € et les couleurs RAG
// viennent du dashboard AE plutôt que d'être redupliqués : les deux onglets
// doivent utiliser exactement les mêmes seuils et le même format.

import type { DealRow, RepSummary, StageBenchmark } from "@/lib/deal-review/types";
import { STALE_CONTACT_DAYS } from "@/lib/deal-review/types";
import { COLORS } from "@/lib/design/tokens";

export { fmtEURCompact, ragColor } from "../helpers";

export function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

export function fmtNum(n: number | null, suffix = ""): string {
  if (n == null) return "—";
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
}

export function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n} %`;
}

/** Couleur d'un delta de touch points face à la médiane de l'étape. */
export function touchDeltaStyle(delta: number | null): { fg: string; label: string } {
  if (delta == null) return { fg: COLORS.ink4, label: "" };
  if (delta <= -3) return { fg: COLORS.err, label: `${delta}` };
  if (delta < 0) return { fg: COLORS.warn, label: `${delta}` };
  if (delta === 0) return { fg: COLORS.ink3, label: "=" };
  return { fg: COLORS.ok, label: `+${delta}` };
}

/** Couleur du délai depuis le dernier contact (aligné sur healthIndicator). */
export function contactColor(days: number | null): string {
  if (days == null) return COLORS.err;
  if (days > STALE_CONTACT_DAYS) return COLORS.err;
  if (days > 7) return COLORS.warn;
  return COLORS.ink2;
}

/* ── Tri du tableau ───────────────────────────────────────────────────── */

export type SortKey =
  | "dealname"
  | "ownerName"
  | "stageOrder"
  | "amount"
  | "score"
  | "touchPoints"
  | "touchDelta"
  | "claapCalls"
  | "daysInStage"
  | "daysSinceContact";

export type SortDir = "asc" | "desc";

/**
 * Delta de touch points du deal par rapport à la médiane de son étape.
 * `null` quand l'étape n'a pas assez de deals pour publier une médiane.
 */
export function touchDelta(deal: DealRow, medianByStage: Map<string, number | null>): number | null {
  const med = medianByStage.get(deal.stageId);
  if (med == null) return null;
  return Math.round(deal.touchPoints - med);
}

export function medianByStageMap(stages: StageBenchmark[]): Map<string, number | null> {
  return new Map(stages.map((s) => [s.stageId, s.medianTouchPoints]));
}

export function sortDeals(
  deals: DealRow[],
  key: SortKey,
  dir: SortDir,
  medianByStage: Map<string, number | null>,
): DealRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (d: DealRow): string | number | null => {
    switch (key) {
      case "dealname":
        return d.dealname.toLowerCase();
      case "ownerName":
        return d.ownerName.toLowerCase();
      case "touchDelta":
        return touchDelta(d, medianByStage);
      default:
        return d[key];
    }
  };
  return [...deals].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Les valeurs absentes finissent toujours en bas, quel que soit le sens.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") return sign * va.localeCompare(vb);
    return sign * (Number(va) - Number(vb));
  });
}

/**
 * Alertes affichées en pastilles sur une ligne de deal.
 *
 * On ne garde que des signaux minoritaires : une alerte présente sur 85 % des
 * lignes n'informe plus. Mesuré sur le portail : 90 % des deals ouverts ont au
 * plus 1 contact associé et 85 % n'ont aucune activité planifiée, donc
 * "1 contact" et "sans suite" sont remontés en agrégat (KPI et tableau par AE)
 * plutôt qu'en pastille de ligne.
 */
export function dealAlerts(
  deal: DealRow,
): Array<{ key: string; label: string; title: string; tone: "err" | "warn" }> {
  const out: Array<{ key: string; label: string; title: string; tone: "err" | "warn" }> = [];
  if (deal.touchPoints === 0) {
    out.push({
      key: "untouched",
      label: "Jamais touché",
      tone: "err",
      title: "Aucun contact loggé dans HubSpot sur ce deal (num_contacted_notes = 0)",
    });
  }
  if (deal.isStalled) {
    out.push({
      key: "stalled",
      label: "Stalled",
      tone: "err",
      title: "HubSpot : temps dans l'étape supérieur de 20 % à la moyenne closed-won de l'owner",
    });
  }
  if (deal.numContacts === 0) {
    out.push({
      key: "no-contact",
      label: "0 contact",
      tone: "warn",
      title: "Aucun contact associé au deal dans le CRM",
    });
  }
  return out;
}

/** Agrégats recalculés côté client quand le nurture est affiché ou un AE filtré. */
export function subsetTotals(deals: DealRow[]) {
  return {
    openDeals: deals.length,
    pipeline: deals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
    stalledCount: deals.filter((d) => d.isStalled).length,
    noNextActivityCount: deals.filter((d) => !d.nextActivityAt).length,
    staleContactCount: deals.filter(
      (d) => d.daysSinceContact == null || d.daysSinceContact > STALE_CONTACT_DAYS,
    ).length,
  };
}

export function repById(reps: RepSummary[], ownerId: string): RepSummary | null {
  return reps.find((r) => r.ownerId === ownerId) ?? null;
}
