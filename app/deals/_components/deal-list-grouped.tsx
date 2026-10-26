"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { scoreBadge } from "@/lib/deal-scoring";
import { COLORS } from "@/lib/design/tokens";
import type { Deal, Stage } from "../_helpers";
import { fmt, fmtDate, isOverdue, stageColor } from "../_helpers";

// Texte des badges assombri pour le contraste (mêmes teintes que scoreBadge).
const SCORE_TEXT: Record<string, string> = {
  "High Priority": "#166534",
  "On Track": "#854d0e",
  Fragile: "#9a3412",
  "At Risk": "#b91c1c",
};

export function DealListGrouped({
  stages,
  dealsByStage,
  selectedId,
  onSelect,
}: {
  stages: Stage[];
  dealsByStage: Record<string, Deal[]>;
  selectedId: string | null;
  onSelect: (d: Deal) => void;
}) {
  // Par défaut seul le groupe du deal ouvert est déplié ; un clic force l'état.
  const [toggles, setToggles] = React.useState<Record<string, boolean>>({});
  const selectedStageId = React.useMemo(
    () => stages.find((s) => (dealsByStage[s.id] ?? []).some((d) => d.id === selectedId))?.id ?? null,
    [stages, dealsByStage, selectedId]
  );
  const isOpen = (id: string) => toggles[id] ?? id === selectedStageId;

  return (
    <div
      className="thin-scrollbar"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 10px 16px",
        overflowY: "auto",
        height: "100%",
      }}
    >
      {stages.map((stage, idx) => {
        const items = dealsByStage[stage.id] ?? [];
        const total = items.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
        const open = isOpen(stage.id);
        return (
          <section key={stage.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              onClick={() => setToggles((t) => ({ ...t, [stage.id]: !open }))}
              aria-expanded={open}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSoft)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {open ? (
                <ChevronDown size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />
              ) : (
                <ChevronRight size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />
              )}
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: stageColor(idx), flexShrink: 0 }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: COLORS.ink0, lineHeight: 1.35 }}>
                {stage.label}
              </span>
              <span style={{ fontSize: 12, color: COLORS.ink2, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {items.length}
                {total > 0 ? ` · ${(total / 1000).toFixed(0)}k€` : ""}
              </span>
            </button>
            {open && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 6 }}>
                {items.length === 0 && (
                  <div style={{ fontSize: 12, color: COLORS.ink4, padding: "4px 12px 6px 38px" }}>No deal</div>
                )}
                {items.map((d) => {
                  const badge = d.score ? scoreBadge(d.score.total) : null;
                  const active = d.id === selectedId;
                  const overdue = isOverdue(d.closedate);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onSelect(d)}
                      aria-current={active ? "true" : undefined}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: 10,
                        border: `1px solid ${active ? "#ffc2d6" : "transparent"}`,
                        background: active ? "#fff1f6" : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                        color: "inherit",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = COLORS.bgSoft;
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {d.dealname || "Untitled"}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {fmt(d.amount)}
                        </span>
                      </span>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%" }}>
                        <span style={{ fontSize: 12, color: COLORS.ink2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {d.ownerName ? d.ownerName.split(" ")[0] : ""}
                          {d.ownerName && d.closedate ? " · " : ""}
                          {d.closedate && (
                            <span style={{ color: overdue ? COLORS.err : undefined, fontWeight: overdue ? 600 : 400 }}>
                              {overdue ? `Overdue ${fmtDate(d.closedate)}` : fmtDate(d.closedate)}
                            </span>
                          )}
                        </span>
                        {badge ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              flexShrink: 0,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 7px",
                              borderRadius: 999,
                              background: badge.bg,
                              color: SCORE_TEXT[badge.label] ?? badge.color,
                            }}
                          >
                            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.score!.total}</span>
                            {badge.label}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: COLORS.ink4, fontStyle: "italic", flexShrink: 0 }}>Unscored</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
