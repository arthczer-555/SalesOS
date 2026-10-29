"use client";

// Détail du target par compte : pour un flux (New / Renew / Renew CSM) et une
// période (année ou trimestre), chaque compte avec son target, son facturé et
// ce qu'il reste à facturer, les plus en retard d'abord. Affiché directement
// dans les blocs My New / My Renew de /dashboard (TargetDetailPanel compact),
// et en modale depuis les cards revenu d'AE Activity (TargetDetailModal).
//
// Les lignes viennent de `stream.byAccount` (lib/ae-activity/account-targets.ts),
// dont la somme redonne le total affiché au-dessus. Si ce n'est pas le cas, on
// montre l'écart plutôt que de le masquer.

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AccountTarget, QuarterAmount, RevenueStream } from "@/lib/ae-activity/types";
import { COLORS } from "@/lib/design/tokens";
import { fmtEUR, ragColor, revenueAttainment } from "./helpers";

export type TargetPeriod = "year" | QuarterAmount["quarter"];
const PERIODS: TargetPeriod[] = ["year", "Q1", "Q2", "Q3", "Q4"];

// "new" : le New n'a d'objectif que par rep, ses comptes n'ont que du facturé.
export type StreamKind = "new" | "renew";

// Au-delà, la liste intégrée au dashboard se replie derrière "Show all".
const COMPACT_ROWS = 8;

type Status = "missed" | "behind" | "upcoming" | "reached" | "unplanned";

const STATUS: Record<Status, { label: string; fg: string; bg: string; rank: number }> = {
  missed: { label: "Missed", fg: "#991b1b", bg: "#fee2e2", rank: 0 },
  behind: { label: "Behind", fg: "#b45309", bg: "#fef3c7", rank: 0 },
  upcoming: { label: "Upcoming", fg: COLORS.ink3, bg: "#f4f4f5", rank: 1 },
  reached: { label: "Reached", fg: "#166534", bg: "#f0fdf4", rank: 2 },
  unplanned: { label: "No target", fg: COLORS.ink3, bg: "#f4f4f5", rank: 3 },
};

type Row = {
  company: string;
  target: number;
  billed: number;
  left: number;
  status: Status;
  notes: string[];
};

/** Un trimestre passé non atteint est raté, l'année et le trimestre en cours sont en retard. */
function statusOf(target: number, billed: number, period: TargetPeriod): Status {
  if (target <= 0) return "unplanned";
  if (billed >= target) return "reached";
  if (period === "year") return "behind";
  const d = Number(period.slice(1)) - (Math.floor(new Date().getUTCMonth() / 3) + 1);
  return d < 0 ? "missed" : d === 0 ? "behind" : "upcoming";
}

function rowsFor(accounts: AccountTarget[], period: TargetPeriod): Row[] {
  return accounts
    .map((a) => {
      const qs = period === "year" ? a.quarters : a.quarters.filter((q) => q.quarter === period);
      const target = qs.reduce((s, q) => s + (q.target ?? 0), 0);
      const billed = qs.reduce((s, q) => s + (q.billed ?? 0), 0);

      const elsewhere = new Map<string | null, number>();
      for (const e of a.billedElsewhere) {
        if (period === "year" || e.quarter === period) elsewhere.set(e.owner, (elsewhere.get(e.owner) ?? 0) + e.billed);
      }
      const notes = [...elsewhere].map(([owner, amount]) =>
        owner ? `${fmtEUR(amount)} billed under ${owner}` : `${fmtEUR(amount)} billed with no owner in the Sheet`,
      );
      if (a.revisedTarget != null && target > 0) notes.push(`2026 target revised to ${fmtEUR(a.revisedTarget)}`);

      return { company: a.company, target, billed, left: Math.max(target - billed, 0), status: statusOf(target, billed, period), notes };
    })
    .filter((r) => r.target > 0 || r.billed > 0)
    .sort(
      (a, b) =>
        STATUS[a.status].rank - STATUS[b.status].rank || b.left - a.left || b.target - a.target || b.billed - a.billed,
    );
}

const isLate = (r: Row) => r.status === "missed" || r.status === "behind";

/** Comptes en retard sur la période, pour le compteur du bouton d'ouverture. */
export function lateAccountCount(stream: RevenueStream, period: TargetPeriod): number {
  return stream.byAccount ? rowsFor(stream.byAccount, period).filter(isLate).length : 0;
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: COLORS.bgSoft }}>
      <div className="text-[17px] font-bold leading-tight tabular-nums" style={{ color: color ?? COLORS.ink0 }}>
        {value}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: COLORS.ink3 }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Détail par compte d'un flux sur une période. `compact` : intégré dans une
 * carte qui affiche déjà le target et le facturé (bloc du dashboard), donc
 * sans tuiles de synthèse et avec une liste repliée au-delà de COMPACT_ROWS.
 */
export function TargetDetailPanel({
  stream,
  kind,
  initialPeriod,
  compact = false,
}: {
  stream: RevenueStream;
  kind: StreamKind;
  initialPeriod: TargetPeriod;
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<TargetPeriod>(initialPeriod);
  const [showAll, setShowAll] = useState(false);
  const year = new Date().getUTCFullYear();
  const periodLabel = period === "year" ? String(year) : `${period} ${year}`;

  const q = period === "year" ? null : stream.quarters.find((x) => x.quarter === period);
  const target = period === "year" ? stream.target : (q?.target ?? null);
  const billed = period === "year" ? stream.billed : (q?.billed ?? null);
  const att = revenueAttainment(billed, target);
  const left = target != null ? Math.max(target - (billed ?? 0), 0) : null;

  const rows = stream.byAccount ? rowsFor(stream.byAccount, period) : [];
  const visible = compact && !showAll ? rows.slice(0, COMPACT_ROWS) : rows;
  const late = rows.filter(isLate);
  const rowsTarget = rows.reduce((s, r) => s + r.target, 0);
  const rowsBilled = rows.reduce((s, r) => s + r.billed, 0);
  const rowsLeft = rows.reduce((s, r) => s + r.left, 0);
  const billedGap = billed != null ? rowsBilled - billed : 0;
  const targetGap = kind === "renew" && target != null ? rowsTarget - target : 0;

  const num = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";
  const emptyPad = compact ? "py-4" : "py-8";

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedControl
          size="sm"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: p === "year" ? "Year" : p }))}
        />
        {compact && (
          <span className="text-[11.5px] tabular-nums" style={{ color: COLORS.ink3 }}>
            {periodLabel} · <strong style={{ color: COLORS.ink0 }}>{fmtEUR(billed)}</strong> billed of{" "}
            {fmtEUR(target)}
            {att != null && (
              <span className="ml-1.5 font-bold" style={{ color: ragColor(att).fg }}>
                {att}%
              </span>
            )}
          </span>
        )}
      </div>

      {!compact && (
        <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <MiniStat label={`Target ${periodLabel}`} value={fmtEUR(target)} />
          <MiniStat label={att != null ? `Billed · ${att}%` : "Billed"} value={fmtEUR(billed)} color={ragColor(att).fg} />
          <MiniStat label="Left to bill" value={fmtEUR(left)} />
          {kind === "renew" && (
            <MiniStat
              label={late.length === 1 ? "Account behind" : "Accounts behind"}
              value={String(late.length)}
              color={late.length > 0 ? STATUS[late.some((r) => r.status === "missed") ? "missed" : "behind"].fg : undefined}
            />
          )}
        </div>
      )}

      {stream.byAccount === undefined ? (
        <p className={`text-[12.5px] ${emptyPad} text-center`} style={{ color: COLORS.ink3 }}>
          The account detail is not in this snapshot yet. It appears after the next refresh.
        </p>
      ) : stream.byAccount === null ? (
        <p className={`text-[12.5px] ${emptyPad} text-center`} style={{ color: COLORS.warn }}>
          The Targets or Factures tab of the revenue Sheet could not be read at the last refresh: account detail
          unavailable.
        </p>
      ) : rows.length === 0 ? (
        <p className={`text-[12.5px] ${emptyPad} text-center`} style={{ color: COLORS.ink3 }}>
          {kind === "renew"
            ? `No account with a target or billing in ${periodLabel}.`
            : `No New business billed in ${periodLabel} yet.`}
        </p>
      ) : (
        <div className={`overflow-x-auto ${compact ? "mt-3" : "mt-4"}`}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-left" style={{ color: COLORS.ink4 }}>
                <th className="pb-1.5 font-medium">Account</th>
                {kind === "renew" && <th className="pb-1.5 pl-3 font-medium text-right">Target</th>}
                <th className="pb-1.5 pl-3 font-medium text-right">Billed</th>
                {kind === "renew" && <th className="pb-1.5 pl-3 font-medium text-right">Left to bill</th>}
                {kind === "renew" && <th className="pb-1.5 pl-3 font-medium text-right">Status</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.company} className="border-t align-top" style={{ borderColor: COLORS.line }}>
                    <td className="py-2" style={{ color: COLORS.ink0 }}>
                      <div className="font-medium">{r.company}</div>
                      {r.notes.map((n) => (
                        <div key={n} className="text-[10.5px] mt-0.5" style={{ color: COLORS.ink3 }}>
                          {n}
                        </div>
                      ))}
                    </td>
                    {kind === "renew" && (
                      <td className={num} style={{ color: COLORS.ink2 }}>
                        {r.target > 0 ? fmtEUR(r.target) : "-"}
                      </td>
                    )}
                    <td className={`${num} font-semibold`} style={{ color: COLORS.ink0 }}>
                      {fmtEUR(r.billed)}
                    </td>
                    {kind === "renew" && (
                      <td className={num} style={{ color: r.left > 0 ? st.fg : COLORS.ink4 }}>
                        {r.left > 0 ? fmtEUR(r.left) : "-"}
                      </td>
                    )}
                    {kind === "renew" && (
                      <td className="py-2 pl-3 text-right">
                        <span
                          className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ color: st.fg, background: st.bg }}
                        >
                          {st.label}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
              {visible.length < rows.length && (
                <tr className="border-t" style={{ borderColor: COLORS.line }}>
                  <td colSpan={kind === "renew" ? 5 : 2} className="py-2">
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="text-[11.5px] font-medium hover:underline"
                      style={{ color: COLORS.brand }}
                    >
                      Show all {rows.length} accounts
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold" style={{ borderColor: COLORS.lineStrong, color: COLORS.ink0 }}>
                <td className="py-2">Total · {rows.length} account{rows.length > 1 ? "s" : ""}</td>
                {kind === "renew" && <td className={num}>{fmtEUR(rowsTarget)}</td>}
                <td className={num}>{fmtEUR(rowsBilled)}</td>
                {kind === "renew" && <td className={num}>{fmtEUR(rowsLeft)}</td>}
                {kind === "renew" && <td />}
              </tr>
            </tfoot>
          </table>

          {(Math.abs(billedGap) > 1 || Math.abs(targetGap) > 1) && (
            <p className="text-[11px] mt-2" style={{ color: COLORS.warn }}>
              ⚠ The accounts add up to {fmtEUR(rowsBilled)} billed
              {kind === "renew" && ` and ${fmtEUR(rowsTarget)} of target`}, the total above says {fmtEUR(billed)}
              {kind === "renew" && ` and ${fmtEUR(target)}`}.
            </p>
          )}
          {kind === "new" && (
            <p className="text-[11px] mt-3" style={{ color: COLORS.ink4 }}>
              New targets are set per rep, not per account: these are the accounts billed as New in {periodLabel}.
            </p>
          )}
          {kind === "renew" && rowsLeft > (left ?? 0) && (
            <p className="text-[11px] mt-3" style={{ color: COLORS.ink4 }}>
              Left to bill is counted per account: billing above target on one account does not offset another.
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function TargetDetailModal({
  title,
  stream,
  kind,
  initialPeriod,
  onClose,
}: {
  title: string;
  stream: RevenueStream;
  kind: StreamKind;
  initialPeriod: TargetPeriod;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      width={880}
      title={title}
      description={
        kind === "renew"
          ? "Target by account, most behind first. Source: revenue Sheet (Targets and Factures tabs)."
          : "Accounts billed as New. Source: revenue Sheet (Factures tab)."
      }
    >
      <TargetDetailPanel stream={stream} kind={kind} initialPeriod={initialPeriod} />
    </Modal>
  );
}
