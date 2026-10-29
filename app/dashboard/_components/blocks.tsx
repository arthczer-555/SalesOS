"use client";

// Briques d'affichage du dashboard, sans aucun fetch : elles reçoivent des
// données déjà prêtes. C'est ce qui permet à /dashboard (données réelles) et à
// /dashboard/demo (données fictives) de partager exactement le même rendu.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { QuarterAmount, RevenueStream } from "@/lib/ae-activity/types";
import type { RepRevenueLine } from "@/lib/dashboard/global-overview";
import type {
  IncentiveStatus,
  IncentiveSummary,
  IncentiveYearBasis,
  QuarterlyIncentiveSummary,
  YearlyIncentiveSummary,
} from "@/lib/incentives/summary";
import { COLORS } from "@/lib/design/tokens";
import {
  fmtEUR,
  fmtEURCompact,
  ragColor,
  revenueAttainment,
  type Kpi,
} from "@/app/admin/ae-activity/_components/helpers";
import {
  TargetDetailPanel,
  lateAccountCount,
  type StreamKind,
} from "@/app/admin/ae-activity/_components/target-detail";

export function currentQuarter(): QuarterAmount["quarter"] {
  return `Q${Math.floor(new Date().getUTCMonth() / 3) + 1}` as QuarterAmount["quarter"];
}

/** Une barre de progression épaisse, lisible d'un coup d'œil. */
export function Progress({ pct, color }: { pct: number | null; color: string }) {
  return (
    <div className="mt-2 h-2.5 rounded-full overflow-hidden" style={{ background: "#efeff1" }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%`, background: color }}
      />
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border ${padded ? "p-5" : ""} ${className}`}
      style={{ borderColor: COLORS.line, background: COLORS.bgCard }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-[15px] font-semibold" style={{ color: COLORS.ink0 }}>
        {title}
      </h2>
      {hint && (
        <span className="text-[11px] shrink-0" style={{ color: COLORS.ink4 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Message d'encouragement calé sur l'avancement du trimestre plutôt que sur le
 * seul pourcentage : à mi-trimestre, 50% d'atteinte est une bonne nouvelle.
 */
export function paceMessage(att: number | null): { text: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (att == null) return { text: "No target set", tone: "muted" };
  const now = new Date();
  const monthInQuarter = now.getUTCMonth() % 3;
  const dayProgress = (monthInQuarter * 30 + now.getUTCDate()) / 90;
  const expected = Math.round(dayProgress * 100);
  if (att >= 100) return { text: "Target reached", tone: "good" };
  if (att >= expected) return { text: `Ahead of pace (${expected}% expected by now)`, tone: "good" };
  if (att >= expected * 0.7) return { text: `Close to pace (${expected}% expected)`, tone: "warn" };
  return { text: `Behind pace (${expected}% expected)`, tone: "bad" };
}

const TONE: Record<string, { fg: string; bg: string }> = {
  good: { fg: "#166534", bg: "#f0fdf4" },
  warn: { fg: "#b45309", bg: "#fef3c7" },
  bad: { fg: "#991b1b", bg: "#fee2e2" },
  muted: { fg: COLORS.ink3, bg: COLORS.bgSoft },
};

/**
 * Bloc de revenu d'un flux (New / Renew / Renew CSM) : année + trimestre, puis
 * le détail par compte directement sous les chiffres (trimestre en cours par
 * défaut), sans clic : c'est ce que le rep vient chercher.
 */
export function StreamBlock({
  title,
  hint,
  kind,
  stream,
  accent,
}: {
  title: string;
  hint: string;
  kind: StreamKind;
  stream: RevenueStream;
  accent: string;
}) {
  const q = currentQuarter();
  const year = new Date().getUTCFullYear();
  const quarter = stream.quarters.find((x) => x.quarter === q);
  const yearAtt = revenueAttainment(stream.billed, stream.target);
  const qAtt = revenueAttainment(quarter?.billed ?? null, quarter?.target ?? null);
  const yearRag = ragColor(yearAtt);
  const qRag = ragColor(qAtt);
  const pace = paceMessage(qAtt);
  const late = kind === "renew" ? lateAccountCount(stream, q) : 0;

  return (
    <Card>
      <SectionTitle title={title} hint={hint} />

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div>
          <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {year}{" "}
            <span className="font-medium" style={{ color: COLORS.ink3 }}>
              to date
            </span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1">
            <span className="text-[32px] leading-none font-bold tabular-nums" style={{ color: accent }}>
              {fmtEURCompact(stream.billed)}
            </span>
            {yearAtt != null && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: yearRag.fg, background: yearRag.bg }}
              >
                {yearAtt}%
              </span>
            )}
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: COLORS.ink3 }}>
            target {fmtEURCompact(stream.target)}
          </div>
          <Progress pct={yearAtt} color={yearRag.fg} />
        </div>

        <div>
          <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {q} {year}{" "}
            <span className="font-medium" style={{ color: COLORS.ink3 }}>
              in progress
            </span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1">
            <span className="text-[32px] leading-none font-bold tabular-nums" style={{ color: COLORS.ink0 }}>
              {fmtEURCompact(quarter?.billed ?? null)}
            </span>
            {qAtt != null && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: qRag.fg, background: qRag.bg }}
              >
                {qAtt}%
              </span>
            )}
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: COLORS.ink3 }}>
            target {fmtEURCompact(quarter?.target ?? null)}
          </div>
          <Progress pct={qAtt} color={qRag.fg} />
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ color: TONE[pace.tone].fg, background: TONE[pace.tone].bg }}
            >
              {pace.text}
            </span>
            {late > 0 && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ color: TONE.bad.fg, background: TONE.bad.bg }}
              >
                {late} account{late > 1 ? "s" : ""} behind
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t" style={{ borderColor: COLORS.line }}>
        <TargetDetailPanel compact stream={stream} kind={kind} initialPeriod={q} />
      </div>
    </Card>
  );
}

const INCENTIVE_STATUS: Record<IncentiveStatus, string> = {
  closed: "Closed",
  in_progress: "In progress",
  upcoming: "Upcoming",
};

const STREAM_TAB: Record<IncentiveSummary["stream"], string> = {
  newBiz: "Suivi New",
  renew: "Suivi Renew",
  csmRenew: "Suivi CSM",
};

// Une décimale : à 29,6 % sous un plancher de 30 %, afficher "30%" mentirait.
const attLabel = (r: number | null) => (r == null ? "-" : `${(r * 100).toFixed(1).replace(/\.0$/, "")}%`);

/**
 * Prime du rep (lib/incentives), visible du seul rep et des admins ("Voir
 * comme") : par trimestre (Mehdi) ou sur l'année, sur les deux targets (Julie).
 */
export function IncentiveBlock({ incentive, accent }: { incentive: IncentiveSummary; accent: string }) {
  return incentive.period === "year" ? (
    <YearlyIncentive incentive={incentive} accent={accent} />
  ) : (
    <QuarterlyIncentive incentive={incentive} accent={accent} />
  );
}

/** "How it's computed" : le barème déroulé, puis d'où viennent les chiffres. */
function IncentiveRules({ rules, children }: { rules: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] mt-3 font-medium hover:underline"
        style={{ color: COLORS.brand }}
      >
        {open ? "Hide how it's computed" : "How it's computed"}
      </button>
      {open && (
        <div className="mt-2 rounded-xl px-3.5 py-3 text-[12px]" style={{ background: COLORS.bgSoft, color: COLORS.ink1 }}>
          <ul className="space-y-1 list-disc pl-4">
            {rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-[11px] mt-2" style={{ color: COLORS.ink3 }}>
            {children}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Plan trimestriel : l'année cumulée, le trimestre en cours et ce qu'il reste
 * à facturer pour franchir le prochain cap, puis un trimestre par ligne.
 */
function QuarterlyIncentive({ incentive, accent }: { incentive: QuarterlyIncentiveSummary; accent: string }) {
  const current = incentive.quarters.find((x) => x.quarter === incentive.currentQuarter) ?? null;
  const next = incentive.nextUnlock;
  const num = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";

  return (
    <Card>
      <SectionTitle title="My incentive" hint={`${incentive.year} plan · paid per quarter`} />

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div>
          <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {incentive.year}{" "}
            <span className="font-medium" style={{ color: COLORS.ink3 }}>
              earned so far
            </span>
          </div>
          <div className="text-[32px] leading-none font-bold tabular-nums mt-1" style={{ color: accent }}>
            {fmtEUR(incentive.total)}
          </div>
          {incentive.incomplete && (
            <div className="text-[11.5px] mt-1.5" style={{ color: COLORS.warn }}>
              Some quarters could not be computed, see below.
            </div>
          )}
        </div>

        {current && (
          <div>
            <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
              {current.quarter} {incentive.year}{" "}
              <span className="font-medium" style={{ color: COLORS.ink3 }}>
                in progress
              </span>
            </div>
            <div className="text-[32px] leading-none font-bold tabular-nums mt-1" style={{ color: COLORS.ink0 }}>
              {fmtEUR(current.amount)}
            </div>
            <div className="text-[12px] mt-1.5" style={{ color: current.error ? COLORS.warn : COLORS.ink3 }}>
              {current.error
                ? current.error
                : current.belowFloor
                  ? `${attLabel(current.attainment)} of quota: below the floor, no incentive yet`
                  : `${attLabel(current.attainment)} of quota so far`}
            </div>
            {next && (
              <span
                className="inline-block text-[11px] px-2 py-0.5 rounded-full mt-2"
                style={{ color: TONE.good.fg, background: TONE.good.bg }}
              >
                {fmtEUR(next.toBill)} more to reach {attLabel(next.threshold)}: {next.label}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto mt-4 pt-3 border-t" style={{ borderColor: COLORS.line }}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-left" style={{ color: COLORS.ink4 }}>
              <th className="pb-1.5 font-medium">Quarter</th>
              <th className="pb-1.5 pl-3 font-medium text-right">Quota</th>
              <th className="pb-1.5 pl-3 font-medium text-right">Billed</th>
              <th className="pb-1.5 pl-3 font-medium text-right">Attainment</th>
              <th className="pb-1.5 pl-3 font-medium text-right">Incentive</th>
            </tr>
          </thead>
          <tbody>
            {incentive.quarters.map((x) => (
              <tr key={x.quarter} className="border-t align-top" style={{ borderColor: COLORS.line }}>
                <td className="py-2" style={{ color: COLORS.ink0 }}>
                  <span className="font-medium">{x.quarter}</span>
                  <span className="text-[10.5px] ml-2" style={{ color: COLORS.ink4 }}>
                    {INCENTIVE_STATUS[x.status]}
                  </span>
                </td>
                <td className={num} style={{ color: COLORS.ink2 }}>
                  {fmtEUR(x.quota)}
                </td>
                <td className={num} style={{ color: COLORS.ink2 }}>
                  {x.status === "upcoming" ? "-" : fmtEUR(x.billed)}
                </td>
                <td className={num} style={{ color: COLORS.ink2 }}>
                  {attLabel(x.attainment)}
                </td>
                <td className={`${num} font-semibold`} style={{ color: COLORS.ink0 }}>
                  {fmtEUR(x.amount)}
                  {(x.error || x.belowFloor || x.capped) && (
                    <div
                      className="text-[10.5px] font-normal mt-0.5"
                      style={{ color: x.error ? COLORS.warn : COLORS.ink3 }}
                    >
                      {x.error ?? (x.belowFloor ? "Below the floor" : "Capped at the top band")}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold" style={{ borderColor: COLORS.lineStrong, color: COLORS.ink0 }}>
              <td className="py-2" colSpan={4}>
                Total {incentive.year}
              </td>
              <td className={num}>{fmtEUR(incentive.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <IncentiveRules rules={incentive.rules}>
        Quota and billed come from the revenue Sheet ({STREAM_TAB[incentive.stream]} and Factures tabs), the same
        figures as the block above. Plan: {incentive.source}. The current quarter is an estimate until it closes.
      </IncentiveRules>
    </Card>
  );
}

const BASIS_LABEL: Record<IncentiveYearBasis["basis"], { title: string; target: string }> = {
  revised: { title: "On revised target", target: "Revised target" },
  initial: { title: "On original target", target: "Original target" },
};

/**
 * Plan annuel : la prime calculée sur le target actualisé et sur le target
 * initial, côte à côte (aucun des deux n'est désigné comme le seul qui paie),
 * puis l'échelle des paliers avec le facturé qu'il faut pour chacun.
 */
function YearlyIncentive({ incentive, accent }: { incentive: YearlyIncentiveSummary; accent: string }) {
  const num = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";
  const inProgress = incentive.status === "in_progress";

  return (
    <Card>
      <SectionTitle title="My incentive" hint={`${incentive.year} plan · paid on the year`} />

      <div className="text-[12px] -mt-1 mb-4" style={{ color: COLORS.ink3 }}>
        {incentive.year} billed{inProgress ? " so far" : ""}:{" "}
        <span className="font-semibold tabular-nums" style={{ color: COLORS.ink0 }}>
          {fmtEUR(incentive.billed)}
        </span>
        {inProgress && " · what the year would pay if it closed today"}
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {incentive.bases.map((b, i) => (
          <div key={b.basis}>
            <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
              {BASIS_LABEL[b.basis].title}
            </div>
            <div
              className="text-[32px] leading-none font-bold tabular-nums mt-1"
              style={{ color: i === 0 ? accent : COLORS.ink0 }}
            >
              {fmtEUR(b.amount)}
            </div>
            <div className="text-[12px] mt-1.5" style={{ color: b.error ? COLORS.warn : COLORS.ink3 }}>
              {b.error ??
                `${BASIS_LABEL[b.basis].target} ${fmtEUR(b.target)} · ${attLabel(b.attainment)} reached${
                  b.amount === 0 ? ", no incentive yet" : b.capped ? ", top step" : ""
                }`}
            </div>
            {b.nextUnlock && (
              <span
                className="inline-block text-[11px] px-2 py-0.5 rounded-full mt-2"
                style={{ color: TONE.good.fg, background: TONE.good.bg }}
              >
                {fmtEUR(b.nextUnlock.toBill)} more to reach {attLabel(b.nextUnlock.threshold)}: {b.nextUnlock.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {incentive.steps && (
        <div className="overflow-x-auto mt-4 pt-3 border-t" style={{ borderColor: COLORS.line }}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-left" style={{ color: COLORS.ink4 }}>
                <th className="pb-1.5 font-medium">Step</th>
                <th className="pb-1.5 pl-3 font-medium text-right">Incentive</th>
                {incentive.bases.map((b) => (
                  <th key={b.basis} className="pb-1.5 pl-3 font-medium text-right">
                    Billed needed · {BASIS_LABEL[b.basis].target.toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incentive.steps.map((st) => (
                <tr key={st.at} className="border-t" style={{ borderColor: COLORS.line }}>
                  <td className="py-2 font-medium" style={{ color: COLORS.ink0 }}>
                    {attLabel(st.at)}
                  </td>
                  <td className={`${num} font-semibold`} style={{ color: COLORS.ink0 }}>
                    {fmtEUR(st.amount)}
                  </td>
                  {incentive.bases.map((b) => {
                    const needed = b.target != null && b.target > 0 ? Math.ceil(st.at * b.target) : null;
                    const reached = b.attainment != null && b.attainment >= st.at;
                    return (
                      <td
                        key={b.basis}
                        className={num}
                        style={{
                          color: reached ? TONE.good.fg : COLORS.ink2,
                          fontWeight: b.reached === st.at ? 600 : undefined,
                        }}
                      >
                        {fmtEUR(needed)}
                        {reached && <span className="ml-1.5">✓</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <IncentiveRules rules={incentive.rules}>
        Original target, revised target and billed come from the revenue Sheet ({STREAM_TAB[incentive.stream]} tab);
        billed and original target are the same figures as the block above. The incentive is shown on both targets.
        Plan: {incentive.source}.{inProgress && " The year is an estimate until it closes."}
      </IncentiveRules>
    </Card>
  );
}

/** Grille des KPI d'activité. */
export function ActivityBlock({ kpis, accent }: { kpis: Kpi[]; accent: string }) {
  return (
    <Card>
      <SectionTitle title="My activity" hint="this month · ▲▼ vs last month" />
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl px-3 py-2.5"
            style={{ background: COLORS.bgSoft }}
          >
            <div className="flex items-baseline">
              <span
                className="text-xl font-bold leading-tight tabular-nums"
                style={{ color: k.accentValue ? accent : COLORS.ink0 }}
              >
                {k.value}
              </span>
              {k.delta && (
                <span
                  className="text-[10px] font-semibold ml-1"
                  style={{
                    color: k.delta.dir === "up" ? "#16a34a" : k.delta.dir === "down" ? "#dc2626" : COLORS.ink3,
                  }}
                >
                  {k.delta.dir === "up" ? "▲" : k.delta.dir === "down" ? "▼" : "→"}{" "}
                  {k.delta.pct == null
                    ? "new"
                    : k.delta.unit === "pts"
                      ? `${Math.abs(k.delta.pct)} pts`
                      : `${Math.abs(k.delta.pct)}%`}
                </span>
              )}
            </div>
            <div className="text-[11px] mt-0.5 font-medium" style={{ color: COLORS.ink2 }}>
              {k.label}
            </div>
            {k.sub && (
              <div className="text-[10px] mt-0.5 leading-tight" style={{ color: COLORS.ink4 }}>
                {k.sub}
              </div>
            )}
          </div>
        ))}
      </div>
      <Link
        href="/deals"
        className="inline-block text-[12px] mt-3 font-medium hover:underline"
        style={{ color: COLORS.brand }}
      >
        Open my pipeline →
      </Link>
    </Card>
  );
}

/** Pouls de l'entreprise : visible par tous, y compris hors équipe sales. */
export function CompanyPulseBlock({
  quarter,
  quarterBilled,
  quarterTarget,
  yearBilled,
  yearTarget,
  year,
}: {
  quarter: string;
  quarterBilled: number | null;
  quarterTarget: number | null;
  yearBilled: number;
  yearTarget: number;
  year: number;
}) {
  const qAtt = revenueAttainment(quarterBilled, quarterTarget);
  const yAtt = revenueAttainment(yearBilled, yearTarget);
  const qRag = ragColor(qAtt);
  const yRag = ragColor(yAtt);

  return (
    <Card>
      <SectionTitle title="Coachello right now" hint="team billing" />
      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div>
          <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {quarter} {year}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1">
            <span className="text-[32px] leading-none font-bold tabular-nums" style={{ color: COLORS.brand }}>
              {fmtEURCompact(quarterBilled)}
            </span>
            {qAtt != null && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: qRag.fg, background: qRag.bg }}
              >
                {qAtt}%
              </span>
            )}
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: COLORS.ink3 }}>
            target {fmtEURCompact(quarterTarget)}
          </div>
          <Progress pct={qAtt} color={qRag.fg} />
        </div>
        <div>
          <div className="text-[15px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {year} <span className="font-medium" style={{ color: COLORS.ink3 }}>to date</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1">
            <span className="text-[32px] leading-none font-bold tabular-nums" style={{ color: COLORS.ink0 }}>
              {fmtEURCompact(yearBilled)}
            </span>
            {yAtt != null && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: yRag.fg, background: yRag.bg }}
              >
                {yAtt}%
              </span>
            )}
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: COLORS.ink3 }}>
            target {fmtEURCompact(yearTarget)}
          </div>
          <Progress pct={yAtt} color={yRag.fg} />
        </div>
      </div>
    </Card>
  );
}

/** Tableau du revenu par sales (vue admin). */
export function RepTable({ reps }: { reps: RepRevenueLine[] }) {
  const max = Math.max(...reps.map((r) => r.totalTarget || 0), 1);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-[15px] font-semibold" style={{ color: COLORS.ink0 }}>
          By rep
        </h2>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: COLORS.ink3 }}>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.ink4 }} />
            billed
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "#e8e8ea" }} />
            target
          </span>
          <span>New + Renew, year to date</span>
        </div>
      </div>
      <div className="space-y-2.5 mt-3">
        {reps.map((r) => {
          const att = r.totalTarget > 0 ? Math.round((r.totalBilled / r.totalTarget) * 100) : null;
          const rag = ragColor(att);
          return (
            <div key={r.ownerId}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="shrink-0"
                    style={{ width: 8, height: 8, borderRadius: "50%", background: r.accent }}
                  />
                  <span className="font-medium truncate" style={{ color: COLORS.ink0 }}>
                    {r.name}
                  </span>
                  {r.roles.length > 0 && (
                    <span className="text-[10px] uppercase shrink-0" style={{ color: COLORS.ink4 }}>
                      {r.roles.join(" · ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: COLORS.ink2 }}>
                  <strong style={{ color: COLORS.ink0 }}>{fmtEURCompact(r.totalBilled)}</strong>
                  {" / "}
                  {fmtEURCompact(r.totalTarget)}
                  {att != null && (
                    <span className="ml-2 font-bold" style={{ color: rag.fg }}>
                      {att}%
                    </span>
                  )}
                </span>
              </div>
              {/* Barres à l'échelle du plus gros objectif : on compare les
                  contributions entre elles, pas chacune à son propre plafond. */}
              <div className="mt-1 h-2 rounded-full overflow-hidden relative" style={{ background: "#f4f4f5" }}>
                <div
                  className="h-full absolute left-0 top-0 rounded-full"
                  style={{ width: `${(r.totalTarget / max) * 100}%`, background: "#e8e8ea" }}
                />
                <div
                  className="h-full absolute left-0 top-0 rounded-full"
                  style={{ width: `${(r.totalBilled / max) * 100}%`, background: r.accent }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10.5px] mt-3" style={{ color: COLORS.ink4 }}>
        All bars share the same scale: total lengths are comparable across reps.
      </p>
    </Card>
  );
}

/**
 * Facturé vs objectif par trimestre.
 *
 * Une barre de progression par trimestre plutôt que deux barres verticales
 * côte à côte : la question posée est « quelle part de l'objectif est faite »,
 * elle se lit dans un remplissage, pas dans une comparaison de hauteurs. La
 * largeur du rail reste proportionnelle à l'objectif, ce qui montre au passage
 * quels trimestres pèsent le plus lourd.
 */
export function QuarterBars({ quarters }: { quarters: QuarterAmount[] }) {
  const maxTarget = Math.max(...quarters.map((q) => Math.max(q.target ?? 0, q.billed ?? 0)), 1);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-[15px] font-semibold" style={{ color: COLORS.ink0 }}>
          By quarter
        </h2>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: COLORS.ink3 }}>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.brand }} />
            billed
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "#e8e8ea" }} />
            target
          </span>
        </div>
      </div>

      <div className="space-y-3 mt-3">
        {quarters.map((q) => {
          const att = revenueAttainment(q.billed, q.target);
          const rag = ragColor(att);
          const railWidth = ((q.target ?? 0) / maxTarget) * 100;
          const fill = att == null ? 0 : Math.min(att, 100);
          return (
            <div key={q.quarter}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[12.5px] font-semibold" style={{ color: COLORS.ink0 }}>
                  {q.quarter}
                </span>
                <span className="text-[11.5px] tabular-nums" style={{ color: COLORS.ink3 }}>
                  <strong style={{ color: COLORS.ink0 }}>{fmtEURCompact(q.billed)}</strong> of{" "}
                  {fmtEURCompact(q.target)}
                  {att != null && (
                    <span
                      className="ml-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ color: rag.fg, background: rag.bg }}
                    >
                      {att}%
                    </span>
                  )}
                </span>
              </div>
              {/* Rail à l'échelle de l'objectif le plus lourd, remplissage à
                  l'échelle de l'atteinte de CE trimestre. */}
              <div className="h-3.5 rounded-full" style={{ width: `${Math.max(railWidth, 4)}%`, background: "#eeeef0" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${fill}%`, background: COLORS.brand }}
                  title={`${fmtEUR(q.billed)} billed of ${fmtEUR(q.target)}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10.5px] mt-3" style={{ color: COLORS.ink4 }}>
        A bar&apos;s full length reflects how heavy that quarter&apos;s target is.
      </p>
    </Card>
  );
}

/** Bandeau de chiffres clés (vue admin). */
export function StatStrip({ stats }: { stats: Array<{ label: string; value: string; hint?: string; accent?: boolean }> }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-2xl border px-4 py-3"
          style={{ borderColor: COLORS.line, background: COLORS.bgCard }}
        >
          <div
            className="text-[22px] font-bold leading-tight tabular-nums"
            style={{ color: s.accent ? COLORS.brand : COLORS.ink0 }}
          >
            {s.value}
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: COLORS.ink2 }}>
            {s.label}
          </div>
          {s.hint && (
            <div className="text-[10px] mt-0.5" style={{ color: COLORS.ink4 }}>
              {s.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="text-center py-8">
      <p className="text-sm font-medium" style={{ color: COLORS.ink1 }}>
        {title}
      </p>
      <p className="text-[13px] mt-1" style={{ color: COLORS.ink3 }}>
        {body}
      </p>
    </Card>
  );
}
