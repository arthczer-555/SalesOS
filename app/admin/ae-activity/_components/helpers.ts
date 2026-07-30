// Helpers d'affichage du dashboard AE : formatage, sommes, deltas période sur
// période, statut RAG et KPIs dérivés.

import type {
  ActivityBucket,
  Coaching,
  FunnelStage,
  Granularity,
  LostReason,
  MonthlyScore,
  QuarterAmount,
  RepSnapshot,
  RevenuePerf,
  RevenueStream,
} from "@/lib/ae-activity/types";
import { GRANULARITIES } from "@/lib/ae-activity/types";
import { newBucket } from "@/lib/ae-activity/aggregate";

export const DISPOSITION_ORDER = [
  "Connected",
  "No answer",
  "Left voicemail",
  "Left live message",
  "Busy",
  "Gatekeeper",
  "Wrong number",
];

export const DISPOSITION_COLORS: Record<string, string> = {
  Connected: "#16a34a",
  "No answer": "#94a3b8",
  "Left voicemail": "#f59e0b",
  "Left live message": "#d97706",
  Busy: "#dc2626",
  Gatekeeper: "#8b5cf6",
  "Wrong number": "#b91c1c",
};

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtEUR(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${Math.round(n).toLocaleString("en-US")} €`;
}

export function fmtEURCompact(n: number | null | undefined): string {
  if (n == null) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M €`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k €`;
  return `${Math.round(n)} €`;
}

export function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

export function sumField(buckets: ActivityBucket[], get: (b: ActivityBucket) => number): number {
  return buckets.reduce((acc, b) => acc + (get(b) || 0), 0);
}

export type Delta = {
  pct: number | null;
  dir: "up" | "down" | "flat";
  unit?: "%" | "pts"; // "pts" pour les écarts de note (une note se compare en points)
} | null;

/**
 * Delta de la dernière période complète vs la précédente, pour un champ donné.
 * null si moins de 2 périodes. pct=null quand la période précédente était à 0
 * (pas de base de comparaison) mais qu'il y a du nouveau (dir=up).
 */
export function deltaFor(buckets: ActivityBucket[], get: (b: ActivityBucket) => number): Delta {
  if (buckets.length < 2) return null;
  const cur = get(buckets[buckets.length - 1]) || 0;
  const prev = get(buckets[buckets.length - 2]) || 0;
  if (prev === 0) return cur > 0 ? { pct: null, dir: "up" } : null;
  const change = ((cur - prev) / prev) * 100;
  return { pct: Math.round(change), dir: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

// Statut RAG d'un % d'atteinte d'objectif (vert ≥ 90, orange ≥ 60, rouge < 60).
export function ragColor(attainmentPct: number | null): { fg: string; bg: string } {
  if (attainmentPct == null) return { fg: "#888", bg: "#f5f5f5" };
  if (attainmentPct >= 90) return { fg: "#166534", bg: "#f0fdf4" };
  if (attainmentPct >= 60) return { fg: "#b45309", bg: "#fef3c7" };
  return { fg: "#991b1b", bg: "#fee2e2" };
}

export type Kpi = {
  label: string;
  value: string;
  sub?: string; // décomposition du chiffre (dont X inbound, N cold…)
  prev?: string; // valeur de la période précédente ("vs 12 le mois dernier")
  delta?: Delta;
  accentValue?: boolean; // valeur en couleur d'accent (KPI clé)
};

// Mot de période (période en cours) selon la granularité, pour le libellé UI.
export const PERIOD_WORD: Record<Granularity, string> = {
  week: "this week",
  month: "this month",
  quarter: "this quarter",
  semester: "this half",
  year: "this year",
};

// Période précédente, pour le sous-texte des cards.
export const PERIOD_PREV_WORD: Record<Granularity, string> = {
  week: "last week",
  month: "last month",
  quarter: "last quarter",
  semester: "last half",
  year: "last year",
};

// Cards de conquête : masquées pour un CSM pur. Il ne prospecte pas, ne booke
// pas de discovery et ne close pas de deals — afficher ces compteurs à zéro
// donnerait l'impression qu'il ne travaille pas, alors que ces métriques ne le
// concernent tout simplement pas.
const CSM_HIDDEN_KPIS = new Set([
  "Meetings booked",
  "Cold calls",
  "Connected",
  "Prospecting emails",
  "Deals won",
]);

/**
 * Note Claap du MOIS EN COURS (indépendante de la granularité sélectionnée :
 * une note mensuelle n'a pas de sens à la semaine, et le trimestre lisserait
 * l'évolution récente). Delta en points vs le mois précédent.
 */
function claapScoreKpi(coaching: Coaching | undefined): Kpi {
  const months = coaching?.scoreByMonth ?? [];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const cur = months.find((m) => m.month === currentMonth);
  // Mois précédent = dernier mois noté AVANT le mois en cours (et pas
  // forcément M-1 : un rep peut n'avoir aucun meeting noté un mois donné).
  const prev = [...months].reverse().find((m) => m.month < currentMonth);

  let delta: Delta = null;
  if (cur && prev) {
    const diff = Math.round((cur.avg - prev.avg) * 10) / 10;
    delta = { pct: diff, dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat", unit: "pts" };
  }

  return {
    label: "Claap score · this month",
    value: cur ? `${cur.avg.toFixed(1)}/10` : "-",
    sub: cur ? `${cur.count} meeting${cur.count > 1 ? "s" : ""} scored` : "no meeting scored this month",
    delta,
  };
}

/**
 * KPI cards : le chiffre principal est la PÉRIODE EN COURS (dernier bucket de la
 * granularité sélectionnée), le delta et le sous-texte comparent à la période
 * précédente. Volontairement limité à 6 cards : au-delà la grille devient une
 * bouillie où plus rien ne ressort. Ce qui n'y tient pas descend en chart.
 *
 * `roles` filtre les cards : un CSM ne prospecte pas, afficher ses appels et
 * ses emails de prospection à zéro donnerait l'impression qu'il ne travaille
 * pas, alors que ces métriques ne le concernent simplement pas.
 *
 * `includeCoachingScore` : la note Claap reste une métrique de pilotage (vue
 * AE Activity), elle n'apparaît pas sur le dashboard personnel.
 */
export function buildKpis(
  buckets: ActivityBucket[],
  coaching: Coaching | undefined,
  gran: Granularity,
  roles: string[] = [],
  includeCoachingScore = true,
): Kpi[] {
  const csmOnly = roles.includes("csm") && !roles.some((r) => r === "ae" || r === "am");
  const n = buckets.length;
  const last = n ? buckets[n - 1] : null;
  const before = n >= 2 ? buckets[n - 2] : null;
  const cur = (get: (b: ActivityBucket) => number): number => (last ? get(last) || 0 : 0);
  const prev = (get: (b: ActivityBucket) => number): number | null => (before ? get(before) || 0 : null);

  /** "vs 12 le mois dernier" — remplace le cumul depuis janvier, qui ne disait
   *  rien de la dynamique en cours. */
  const vsPrev = (get: (b: ActivityBucket) => number): string | undefined => {
    const p = prev(get);
    return p == null ? undefined : `vs ${fmtInt(p)} ${PERIOD_PREV_WORD[gran]}`;
  };

  // Le payload d'un snapshot est figé au moment de son calcul : un compteur
  // ajouté depuis manque tout simplement du JSONB, et se lit `undefined` → 0.
  // Un « 0% » indistinguable d'un vrai zéro est exactement ce que le README
  // interdit, donc on détecte l'absence et on affiche "-" en attendant le
  // prochain refresh.
  const has = (field: keyof ActivityBucket): boolean =>
    last == null || (last as Partial<ActivityBucket>)[field] !== undefined;

  const curOutbound = cur((b) => b.outboundCalls);
  const curCold = cur((b) => b.callsCold);
  const curConnected = cur((b) => b.connectedColdCalls);
  const coldRateKnown = has("connectedColdCalls");
  const curWon = cur((b) => b.closedWon);
  const curLost = cur((b) => b.closedLost);
  const cumSlack = sumField(buckets, (b) => b.selfBookedSlack);

  // Les meetings bookés se comptent depuis Slack #new-meetings : c'est la
  // déclaration de l'AE, alors que HubSpot date les meetings à leur tenue et
  // rate ceux qui ne sont pas logués. Repli sur HubSpot si Slack est inerte
  // (canal ou token non configurés), pour ne pas afficher 0 partout.
  const slackActive = cumSlack > 0;
  const bookedField = (b: ActivityBucket): number =>
    slackActive ? b.selfBookedSlack : b.meetingsScheduled;

  // Taux de conversation : sa variation se lit en POINTS. Un pourcentage de
  // pourcentage ("+40%") serait illisible.
  //
  // Dénominateur = les COLD calls, pas tous les sortants. Un appel à un contact
  // déjà sur un deal aboutit presque toujours (rendez-vous convenu) et gonflait
  // un taux censé mesurer la capacité à accrocher un inconnu au téléphone.
  const curRate = pct(curConnected, curCold);
  const prevCold = prev((b) => b.callsCold);
  const prevConnected = prev((b) => b.connectedColdCalls);
  const prevRate =
    prevCold != null && prevConnected != null && prevCold > 0 ? pct(prevConnected, prevCold) : null;
  const rateDelta: Delta =
    prevRate == null
      ? null
      : {
          pct: curRate - prevRate,
          dir: curRate > prevRate ? "up" : curRate < prevRate ? "down" : "flat",
          unit: "pts",
        };

  return [
    {
      label: "Meetings booked",
      value: fmtInt(cur(bookedField)),
      sub: slackActive
        ? `${fmtInt(cur((b) => b.meetingsInboundSourced))} inbound · logged in Slack`
        : "HubSpot source (Slack unavailable)",
      prev: vsPrev(bookedField),
      delta: deltaFor(buckets, bookedField),
      accentValue: true,
    },
    // Le chiffre mis en avant est le COLD, pas le total : c'est l'effort de
    // conquête, la seule part sur laquelle le rep décide. Le total reste en
    // sous-texte pour situer. Delta et comparaison suivent donc le cold, sinon
    // la variation affichée décrirait un autre chiffre que celui en gros.
    {
      label: "Cold calls",
      value: fmtInt(cur((b) => b.callsCold)),
      sub: `${fmtInt(curOutbound)} outbound total · ${fmtInt(cur((b) => b.callsOnDeal))} on a deal`,
      prev: vsPrev((b) => b.callsCold),
      delta: deltaFor(buckets, (b) => b.callsCold),
    },
    {
      label: "Connected",
      value: !coldRateKnown || curCold === 0 ? "-" : `${curRate}%`,
      sub: coldRateKnown
        ? `${fmtInt(curConnected)} cold calls over 1 min`
        : "not computed yet · waiting for the next refresh",
      prev: !coldRateKnown || prevRate == null ? undefined : `vs ${prevRate}% ${PERIOD_PREV_WORD[gran]}`,
      delta: coldRateKnown ? rateDelta : null,
    },
    {
      label: "Prospecting emails",
      value: fmtInt(cur((b) => b.emailsCold)),
      sub: `${fmtInt(cur((b) => b.emailsOnDeal))} more on a deal`,
      prev: vsPrev((b) => b.emailsCold),
      delta: deltaFor(buckets, (b) => b.emailsCold),
    },
    {
      label: "Deals won",
      value: fmtInt(curWon),
      sub: `${curLost} lost · win ${pct(curWon, curWon + curLost)}%`,
      prev: vsPrev((b) => b.closedWon),
      delta: deltaFor(buckets, (b) => b.closedWon),
      accentValue: true,
    },
    // Ce que fait réellement un CSM : tenir ses points clients. Le compteur
    // vient de Claap, et n'apparaît que là où les cards de conquête ont été
    // retirées — il ne s'ajoute jamais aux six cards d'un AE.
    ...(csmOnly
      ? [
          {
            label: "Meetings held",
            value: fmtInt(cur((b) => b.meetingsHeld)),
            sub: "recorded in Claap",
            prev: vsPrev((b) => b.meetingsHeld),
            delta: deltaFor(buckets, (b) => b.meetingsHeld),
            accentValue: true,
          } satisfies Kpi,
        ]
      : []),
    ...(includeCoachingScore ? [claapScoreKpi(coaching)] : []),
  ].filter((k) => !(csmOnly && CSM_HIDDEN_KPIS.has(k.label)));
}

// Dispositions présentes dans les buckets, ordonnées (ordre canonique puis reste).
export function dispositionLabels(buckets: ActivityBucket[]): string[] {
  const present = new Set<string>();
  for (const b of buckets) for (const k of Object.keys(b.dispositions || {})) present.add(k);
  const ordered = DISPOSITION_ORDER.filter((l) => present.has(l));
  const rest = [...present].filter((l) => !DISPOSITION_ORDER.includes(l));
  return [...ordered, ...rest];
}

export function lastRefreshLabel(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const h = diff / 3_600_000;
  const rel = h < 1 ? "< 1h ago" : h < 24 ? `${Math.round(h)}h ago` : `${Math.floor(h / 24)}d ago`;
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} (${rel})`;
}

// Totaux revenu pour affichage compact.
export function revenueAttainment(billed: number | null, target: number | null): number | null {
  if (billed == null || target == null || target === 0) return null;
  return Math.round((billed / target) * 100);
}

// ── Agrégation équipe (vue "Tous") ────────────────────────────────────────

const NUM_FIELDS = [
  "outboundCalls",
  "inboundCalls",
  "connectedCalls",
  "connectedColdCalls",
  "callsOnDeal",
  "callsCold",
  "emailsOut",
  "emailsCold",
  "emailsOnDeal",
  "meetingsScheduled",
  "meetingsInboundSourced",
  "meetingsSelfSourced",
  "meetingsHeld",
  "selfBookedSlack",
  "dealsOpened",
  "dealsOpenedInbound",
  "leadsInbound",
  "closedWon",
  "closedLost",
] as const;

function mergeBuckets(lists: ActivityBucket[][]): ActivityBucket[] {
  const map = new Map<string, ActivityBucket>();
  for (const list of lists) {
    for (const b of list) {
      let m = map.get(b.key);
      if (!m) {
        m = newBucket(b.key, b.label);
        map.set(b.key, m);
      }
      for (const f of NUM_FIELDS) m[f] = (m[f] as number) + ((b[f] as number) || 0);
      for (const [k, v] of Object.entries(b.dispositions || {})) {
        m.dispositions[k] = (m.dispositions[k] || 0) + v;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function mergeFunnelStages(lists: FunnelStage[][]): FunnelStage[] {
  const map = new Map<string, FunnelStage>();
  for (const list of lists) {
    for (const s of list ?? []) {
      const cur = map.get(s.id);
      if (cur) cur.count += s.count;
      else map.set(s.id, { id: s.id, label: s.label, count: s.count });
    }
  }
  return [...map.values()];
}

function mergeLost(reps: RepSnapshot[]): LostReason[] {
  const map = new Map<string, number>();
  for (const r of reps) {
    for (const l of r.lostReasons) map.set(l.reason, (map.get(l.reason) || 0) + l.count);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Note Claap de l'équipe : moyenne pondérée par le nombre de meetings notés, et
 * non moyenne des moyennes (un rep avec 1 meeting ne doit pas peser autant
 * qu'un rep avec 15).
 */
function mergeScores(reps: RepSnapshot[]): MonthlyScore[] {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of reps) {
    for (const s of r.coaching.scoreByMonth ?? []) {
      const cur = acc.get(s.month) ?? { sum: 0, count: 0 };
      cur.sum += s.avg * s.count;
      cur.count += s.count;
      acc.set(s.month, cur);
    }
  }
  return [...acc.entries()]
    .map(([month, { sum, count }]) => ({ month, avg: Math.round((sum / count) * 10) / 10, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Somme un flux de revenu sur tous les reps. `null` est conservé quand AUCUN
 * rep n'a la donnée (Sheet non lu) : afficher 0 laisserait croire à un objectif
 * réel à zéro.
 */
function mergeStream(reps: RepSnapshot[], pick: (rv: RevenuePerf) => RevenueStream): RevenueStream {
  const streams = reps.map((r) => pick(r.revenue));

  const sum = (get: (s: RevenueStream) => number | null): number | null => {
    let any = false;
    let total = 0;
    for (const s of streams) {
      const v = get(s);
      if (v != null) {
        any = true;
        total += v;
      }
    }
    return any ? total : null;
  };

  const qMap = new Map<string, { target: number | null; billed: number | null }>();
  for (const s of streams) {
    for (const q of s.quarters) {
      const cur = qMap.get(q.quarter) ?? { target: null, billed: null };
      if (q.target != null) cur.target = (cur.target ?? 0) + q.target;
      if (q.billed != null) cur.billed = (cur.billed ?? 0) + q.billed;
      qMap.set(q.quarter, cur);
    }
  }
  const order: QuarterAmount["quarter"][] = ["Q1", "Q2", "Q3", "Q4"];

  return {
    target: sum((s) => s.target),
    billed: sum((s) => s.billed),
    quarters: order.filter((q) => qMap.has(q)).map((q) => ({ quarter: q, ...qMap.get(q)! })),
    accounts: streams.flatMap((s) => s.accounts).sort((a, b) => b.billed - a.billed),
  };
}

function mergeRevenue(reps: RepSnapshot[]): RevenuePerf {
  return {
    matched: reps.some((r) => r.revenue.matched),
    sheetName: null,
    newBiz: mergeStream(reps, (rv) => rv.newBiz),
    renew: mergeStream(reps, (rv) => rv.renew),
    csmRenew: mergeStream(reps, (rv) => rv.csmRenew),
  };
}

/**
 * Fusionne tous les reps en un snapshot équipe unique (vue "Tous") : buckets
 * sommés par période, funnel et raisons de perte cumulés, revenu/objectifs
 * additionnés. Le coaching (par rep) n'est pas agrégé.
 */
export function aggregateReps(reps: RepSnapshot[]): RepSnapshot {
  const byGranularity = Object.fromEntries(
    GRANULARITIES.map((g) => [g, mergeBuckets(reps.map((r) => r.byGranularity[g] ?? []))]),
  ) as RepSnapshot["byGranularity"];

  return {
    repOwnerId: "__all__",
    repName: `All reps · ${reps.length}`,
    repEmail: null,
    roles: [],
    accent: "#f01563",
    byGranularity,
    funnel: mergeFunnelStages(reps.map((r) => r.funnel)),
    leadsFunnel: mergeFunnelStages(reps.map((r) => r.leadsFunnel)),
    lostReasons: mergeLost(reps),
    revenue: mergeRevenue(reps),
    slackMeetings: reps
      .flatMap((r) => r.slackMeetings ?? [])
      .sort((a, b) => b.ts.localeCompare(a.ts)),
    coaching: {
      meetingsAnalyzed: reps.reduce((s, r) => s + r.coaching.meetingsAnalyzed, 0),
      scoreByMonth: mergeScores(reps),
    },
    dataWarnings: [],
  };
}
