// Helpers d'affichage du Deal Review. Les formateurs € et les couleurs RAG
// viennent du dashboard AE plutôt que d'être redupliqués : les deux onglets
// doivent utiliser exactement les mêmes seuils et le même format.
//
// L'UI de cet onglet est en anglais (vocabulaire sales partagé avec HubSpot).

import type { ClosedDealRow, DealRow, RepSummary, StageBenchmark } from "@/lib/deal-review/types";
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
  return n == null ? "—" : `${n}%`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function fmtLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

/* ── Filtres cliquables ───────────────────────────────────────────────── */

/**
 * Un "flag" est un sous-ensemble de deals ouverts adressable en un clic :
 * chaque KPI, chaque pastille d'alerte et chaque cellule du tableau par AE
 * pointe vers l'un de ces flags. Une seule définition du prédicat pour que le
 * compteur du KPI et la liste filtrée ne puissent jamais diverger.
 */
export type DealFlag = "stalled" | "staleContact" | "noNextStep" | "untouched" | "noContact";

export const FLAG_LABEL: Record<DealFlag, string> = {
  stalled: "Stalled",
  staleContact: `No contact >${STALE_CONTACT_DAYS}d`,
  noNextStep: "No next step",
  untouched: "Never touched",
  noContact: "0 contacts",
};

export const FLAG_HINT: Record<DealFlag, string> = {
  stalled: "HubSpot: time in stage is 20% above the owner's closed-won average",
  staleContact: `No activity logged in the CRM for more than ${STALE_CONTACT_DAYS} days`,
  noNextStep: "No next activity scheduled in HubSpot",
  untouched: "No contact logged on this deal (num_contacted_notes = 0)",
  noContact: "No contact record associated with the deal in the CRM",
};

export function matchesFlag(deal: DealRow, flag: DealFlag): boolean {
  switch (flag) {
    case "stalled":
      return deal.isStalled;
    case "staleContact":
      return deal.daysSinceContact == null || deal.daysSinceContact > STALE_CONTACT_DAYS;
    case "noNextStep":
      return !deal.nextActivityAt;
    case "untouched":
      return deal.touchPoints === 0;
    case "noContact":
      return deal.numContacts === 0;
  }
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
  return [...deals].sort((a, b) => compare(value(a), value(b), sign));
}

/* ── Tri du tableau des deals clos ────────────────────────────────────── */

export type ClosedSortKey =
  | "dealname"
  | "ownerName"
  | "won"
  | "amount"
  | "closedate"
  | "daysToClose"
  | "touchPoints";

export function sortClosedDeals(
  deals: ClosedDealRow[],
  key: ClosedSortKey,
  dir: SortDir,
): ClosedDealRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (d: ClosedDealRow): string | number | null => {
    switch (key) {
      case "dealname":
        return d.dealname.toLowerCase();
      case "ownerName":
        return d.ownerName.toLowerCase();
      case "won":
        return d.won ? 1 : 0;
      case "closedate": {
        const ms = d.closedate ? Date.parse(d.closedate) : NaN;
        return Number.isNaN(ms) ? null : ms;
      }
      default:
        return d[key];
    }
  };
  return [...deals].sort((a, b) => compare(value(a), value(b), sign));
}

/** Comparateur commun : les valeurs absentes finissent en bas dans les deux sens. */
function compare(va: string | number | null, vb: string | number | null, sign: number): number {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "string" && typeof vb === "string") return sign * va.localeCompare(vb);
  return sign * (Number(va) - Number(vb));
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
export function dealAlerts(deal: DealRow): Array<{ flag: DealFlag; tone: "err" | "warn" }> {
  const out: Array<{ flag: DealFlag; tone: "err" | "warn" }> = [];
  if (matchesFlag(deal, "untouched")) out.push({ flag: "untouched", tone: "err" });
  if (matchesFlag(deal, "stalled")) out.push({ flag: "stalled", tone: "err" });
  if (matchesFlag(deal, "noContact")) out.push({ flag: "noContact", tone: "warn" });
  return out;
}

/** Agrégats recalculés côté client quand le nurture est affiché ou un AE filtré. */
export function subsetTotals(deals: DealRow[]) {
  return {
    openDeals: deals.length,
    pipeline: deals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
    stalledCount: deals.filter((d) => matchesFlag(d, "stalled")).length,
    noNextActivityCount: deals.filter((d) => matchesFlag(d, "noNextStep")).length,
    staleContactCount: deals.filter((d) => matchesFlag(d, "staleContact")).length,
    untouchedCount: deals.filter((d) => matchesFlag(d, "untouched")).length,
  };
}

export function repById(reps: RepSummary[], ownerId: string): RepSummary | null {
  return reps.find((r) => r.ownerId === ownerId) ?? null;
}

export type QuarterFilter = "all" | "Q1" | "Q2" | "Q3" | "Q4";
export const QUARTER_FILTERS: QuarterFilter[] = ["all", "Q1", "Q2", "Q3", "Q4"];

/** Trimestre (UTC) d'une date de closing. */
export function quarterOf(iso: string | null): QuarterFilter | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return `Q${Math.floor(new Date(t).getUTCMonth() / 3) + 1}` as QuarterFilter;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Recalcule win rate et touches to close sur un sous-ensemble de deals clos.
 * Utilisé uniquement quand un trimestre est sélectionné : sinon on garde les
 * chiffres du serveur, qui appliquent les seuils d'échantillon.
 */
export function closedSubsetStats(deals: ClosedDealRow[]): {
  won: number;
  lost: number;
  winRate: number | null;
  medianTouches: number | null;
} {
  const won = deals.filter((d) => d.won);
  const lost = deals.filter((d) => !d.won);
  return {
    won: won.length,
    lost: lost.length,
    winRate: deals.length > 0 ? Math.round((won.length / deals.length) * 100) : null,
    medianTouches: median(won.map((d) => d.touchPoints).filter((v): v is number => v != null)),
  };
}
