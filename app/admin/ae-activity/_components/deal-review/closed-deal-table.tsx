"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ClosedDealRow } from "@/lib/deal-review/types";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import {
  fmtDate,
  fmtEURCompact,
  firstName,
  sortClosedDeals,
  type ClosedSortKey,
  type SortDir,
} from "./helpers";

type Column = {
  key: ClosedSortKey;
  label: string;
  align: "left" | "right";
  width?: number;
  title?: string;
};

function columns(showOwner: boolean): Column[] {
  return [
    { key: "dealname", label: "Deal", align: "left" },
    ...(showOwner ? [{ key: "ownerName" as ClosedSortKey, label: "AE", align: "left" as const, width: 92 }] : []),
    { key: "won", label: "Result", align: "left", width: 96, title: "HubSpot convention: hs_is_closed_won" },
    { key: "amount", label: "Amount", align: "right", width: 88, title: "HubSpot amount, empty on part of the pipeline" },
    { key: "closedate", label: "Closed", align: "right", width: 96 },
    { key: "daysToClose", label: "Cycle", align: "right", width: 84, title: "days_to_close: days between creation and closing" },
    {
      key: "touchPoints",
      label: "Touches",
      align: "right",
      width: 96,
      title: "num_contacted_notes logged on the deal before closing",
    },
  ];
}

/**
 * Deals clos sur la période. Ouverte depuis les KPI win rate / avg touches to
 * close : le chiffre agrégé doit toujours pouvoir se déplier en lignes.
 */
export function ClosedDealTable({
  deals,
  showOwner,
  sortKey,
  sortDir,
  onSortChange,
  onFilterRep,
  onFilterResult,
}: {
  deals: ClosedDealRow[];
  showOwner: boolean;
  sortKey: ClosedSortKey;
  sortDir: SortDir;
  onSortChange: (key: ClosedSortKey, dir: SortDir) => void;
  onFilterRep: (ownerId: string) => void;
  onFilterResult: (won: boolean) => void;
}) {
  const sorted = useMemo(() => sortClosedDeals(deals, sortKey, sortDir), [deals, sortKey, sortDir]);
  const cols = columns(showOwner);

  function onSort(key: ClosedSortKey) {
    if (key === sortKey) {
      onSortChange(key, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(key, key === "dealname" || key === "ownerName" ? "asc" : "desc");
    }
  }

  if (deals.length === 0) {
    return (
      <div
        className="text-center text-sm py-14"
        style={{ color: COLORS.ink4, background: COLORS.bgCard, borderRadius: RADIUS.lg, border: `1px solid ${COLORS.line}` }}
      >
        No closed deal matches the current filters.
      </div>
    );
  }

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOWS.card,
        overflowX: "auto",
      }}
    >
      <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: COLORS.bgSoft }}>
            {cols.map((c) => {
              const active = c.key === sortKey;
              return (
                <th
                  key={c.label}
                  title={c.title}
                  onClick={() => onSort(c.key)}
                  style={{
                    textAlign: c.align,
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    color: active ? COLORS.ink0 : COLORS.ink3,
                    borderBottom: `1px solid ${COLORS.line}`,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    width: c.width,
                    userSelect: "none",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {c.label}
                    {active && (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.id} className="interactive-row" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
              <td style={{ padding: "9px 12px" }}>
                <Link
                  href={`/deals?dealId=${d.id}`}
                  title="Open the deal detail panel"
                  style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.ink0, fontWeight: 500 }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: d.ownerAccent,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                    {d.dealname}
                  </span>
                </Link>
              </td>

              {showOwner && (
                <td style={{ padding: "9px 12px", color: COLORS.ink2, whiteSpace: "nowrap" }}>
                  <span
                    role="button"
                    tabIndex={0}
                    className="filter-cell"
                    title={`Filter on ${d.ownerName}`}
                    onClick={() => onFilterRep(d.ownerId)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onFilterRep(d.ownerId);
                    }}
                  >
                    {firstName(d.ownerName)}
                  </span>
                </td>
              )}

              <td style={{ padding: "9px 12px" }}>
                <span
                  role="button"
                  tabIndex={0}
                  className="filter-cell"
                  title={d.won ? "Show won deals only" : "Show lost deals only"}
                  onClick={() => onFilterResult(d.won)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onFilterResult(d.won);
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: d.won ? COLORS.ok : COLORS.err,
                      background: d.won ? COLORS.okBg : COLORS.errBg,
                    }}
                  >
                    {d.won ? "Won" : "Lost"}
                  </span>
                </span>
              </td>

              <td style={cell(COLORS.ink0, 500)}>
                {d.amount == null ? <span style={{ color: COLORS.ink4 }}>—</span> : fmtEURCompact(d.amount)}
              </td>
              <td style={cell(COLORS.ink2)}>{fmtDate(d.closedate)}</td>
              <td style={cell(COLORS.ink1)}>
                {d.daysToClose == null ? "—" : `${Math.round(d.daysToClose)}d`}
              </td>
              <td style={cell(COLORS.ink0, 600)}>{d.touchPoints ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cell(color: string, weight = 400): React.CSSProperties {
  return {
    padding: "9px 12px",
    textAlign: "right",
    whiteSpace: "nowrap",
    color,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
  };
}
