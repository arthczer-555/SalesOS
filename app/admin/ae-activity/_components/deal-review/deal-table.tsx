"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DealRow, StageBenchmark } from "@/lib/deal-review/types";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import { ScoreBadge } from "@/components/ui/score-badge";
import { stageColor } from "@/app/deals/_helpers";
import { reliabilityColor } from "@/lib/deal-scoring";
import {
  contactColor,
  dealAlerts,
  FLAG_HINT,
  FLAG_LABEL,
  fmtEURCompact,
  fmtNum,
  firstName,
  medianByStageMap,
  sortDeals,
  touchDelta,
  touchDeltaStyle,
  type DealFlag,
  type SortDir,
  type SortKey,
} from "./helpers";

type Column = {
  key: SortKey | null;
  label: string;
  align: "left" | "right" | "center";
  width?: number;
  title?: string;
};

function columns(showOwner: boolean): Column[] {
  return [
    { key: "dealname", label: "Deal", align: "left" },
    ...(showOwner ? [{ key: "ownerName" as SortKey, label: "AE", align: "left" as const, width: 92 }] : []),
    { key: "stageOrder", label: "Stage", align: "left", width: 176 },
    { key: "amount", label: "Amount", align: "right", width: 88, title: "HubSpot amount, empty on part of the pipeline" },
    { key: "score", label: "Score", align: "right", width: 92, title: "AI score /100 (SalesOS)" },
    {
      key: "touchPoints",
      label: "Touch pts",
      align: "right",
      width: 108,
      title: "num_contacted_notes: calls, emails, meetings, LinkedIn, SMS logged in HubSpot",
    },
    { key: "claapCalls", label: "Claap", align: "right", width: 84, title: "Claap meetings analysed + average score /10" },
    { key: "daysSinceContact", label: "Freshness", align: "right", width: 116, title: "Days in stage · days since last contact" },
    { key: null, label: "Alerts", align: "left", width: 200 },
  ];
}

/** Cellule cliquable : tout ce qui filtre partage le même affordance visuel. */
function FilterCell({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="filter-cell"
    >
      {children}
    </span>
  );
}

export function DealTable({
  deals,
  stages,
  showOwner,
  sortKey,
  sortDir,
  onSortChange,
  onFilterStage,
  onFilterRep,
  onFilterFlag,
}: {
  deals: DealRow[];
  stages: StageBenchmark[];
  showOwner: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey, dir: SortDir) => void;
  onFilterStage: (stageId: string) => void;
  onFilterRep: (ownerId: string) => void;
  onFilterFlag: (flag: DealFlag) => void;
}) {
  const medianByStage = useMemo(() => medianByStageMap(stages), [stages]);
  const sorted = useMemo(
    () => sortDeals(deals, sortKey, sortDir, medianByStage),
    [deals, sortKey, sortDir, medianByStage],
  );
  const cols = columns(showOwner);

  function onSort(key: SortKey | null) {
    if (!key) return;
    if (key === sortKey) {
      onSortChange(key, sortDir === "asc" ? "desc" : "asc");
    } else {
      // Les colonnes textuelles se lisent mieux de A à Z, les chiffres du plus grand au plus petit.
      onSortChange(key, key === "dealname" || key === "ownerName" ? "asc" : "desc");
    }
  }

  if (deals.length === 0) {
    return (
      <div
        className="text-center text-sm py-14"
        style={{ color: COLORS.ink4, background: COLORS.bgCard, borderRadius: RADIUS.lg, border: `1px solid ${COLORS.line}` }}
      >
        No deal matches the current filters.
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
      <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse", fontSize: 13 }}>
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
                    cursor: c.key ? "pointer" : "default",
                    whiteSpace: "nowrap",
                    width: c.width,
                    userSelect: "none",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {c.label}
                    {active &&
                      (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => {
            const delta = touchDelta(d, medianByStage);
            const deltaStyle = touchDeltaStyle(delta);
            const alerts = dealAlerts(d);
            return (
              <tr key={d.id} className="interactive-row" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                {/* Deal — lien vers le panneau de détail existant de /deals */}
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
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                      {d.dealname}
                    </span>
                    {d.isNurture && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: 999,
                          background: COLORS.bgSoft,
                          color: COLORS.ink3,
                          flexShrink: 0,
                        }}
                      >
                        nurture
                      </span>
                    )}
                  </Link>
                </td>

                {showOwner && (
                  <td style={{ padding: "9px 12px", color: COLORS.ink2, whiteSpace: "nowrap" }}>
                    <FilterCell
                      onClick={() => onFilterRep(d.ownerId)}
                      title={`Filter on ${d.ownerName}`}
                    >
                      {firstName(d.ownerName)}
                    </FilterCell>
                  </td>
                )}

                {/* Étape — cliquable pour isoler l'étape */}
                <td style={{ padding: "9px 12px" }}>
                  <FilterCell
                    onClick={() => onFilterStage(d.stageId)}
                    title={`Filter on stage "${d.stageLabel}"`}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        verticalAlign: "middle",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: stageColor(d.stageOrder),
                        background: `${stageColor(d.stageOrder)}14`,
                      }}
                    >
                      {d.stageLabel}
                    </span>
                  </FilterCell>
                </td>

                {/* Montant */}
                <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {d.amount == null ? (
                    <span style={{ color: COLORS.ink4 }}>—</span>
                  ) : (
                    <span style={{ color: COLORS.ink0, fontWeight: 500 }}>{fmtEURCompact(d.amount)}</span>
                  )}
                </td>

                {/* Note IA + fiabilité de la qualification */}
                <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <ScoreBadge value={d.score} scale={100} size="sm" />
                    {d.reliability != null && (
                      <span
                        title={`${d.reliability}/5 qualification properties filled in`}
                        style={{ fontSize: 10, fontWeight: 700, color: reliabilityColor(d.reliability) }}
                      >
                        {d.reliability}/5
                      </span>
                    )}
                  </span>
                </td>

                {/* Touch points + écart à la médiane de l'étape */}
                <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <span
                    title={`${d.touchPoints} logged contacts · ${d.salesActivities} activities in total (notes and tasks included)`}
                    style={{ color: COLORS.ink0, fontWeight: 600 }}
                  >
                    {d.touchPoints}
                  </span>
                  {delta != null && (
                    <span
                      title={`Median for stage "${d.stageLabel}": ${fmtNum(medianByStage.get(d.stageId) ?? null)}`}
                      style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: deltaStyle.fg }}
                    >
                      {deltaStyle.label}
                    </span>
                  )}
                </td>

                {/* Claap */}
                <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {d.claapCalls === 0 ? (
                    <span style={{ color: COLORS.ink4 }}>—</span>
                  ) : (
                    <span style={{ color: COLORS.ink1 }}>
                      {d.claapCalls}
                      {d.claapAvgScore != null && (
                        <span style={{ color: COLORS.ink3, fontSize: 11, marginLeft: 4 }}>
                          {fmtNum(d.claapAvgScore)}/10
                        </span>
                      )}
                    </span>
                  )}
                </td>

                {/* Fraîcheur : jours dans l'étape · jours depuis le dernier contact */}
                <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <span title="Days in the current stage" style={{ color: COLORS.ink3 }}>
                    {d.daysInStage == null ? "—" : `${d.daysInStage}d`}
                  </span>
                  <span style={{ color: COLORS.ink5, margin: "0 4px" }}>·</span>
                  <span
                    title={
                      d.daysSinceContact == null
                        ? "Never contacted (no activity logged)"
                        : `Last contact ${d.daysSinceContact} days ago`
                    }
                    style={{ color: contactColor(d.daysSinceContact), fontWeight: 600 }}
                  >
                    {d.daysSinceContact == null ? "never" : `${d.daysSinceContact}d`}
                  </span>
                </td>

                {/* Alertes — chaque pastille filtre le tableau sur ce signal */}
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {alerts.map((a) => (
                      <FilterCell
                        key={a.flag}
                        onClick={() => onFilterFlag(a.flag)}
                        title={`${FLAG_HINT[a.flag]} — click to filter`}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: 999,
                            color: a.tone === "err" ? COLORS.err : COLORS.warn,
                            background: a.tone === "err" ? COLORS.errBg : COLORS.warnBg,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {FLAG_LABEL[a.flag]}
                        </span>
                      </FilterCell>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
