"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { COLORS, RADIUS } from "@/lib/design/tokens";

export function RepDropZone({
  label,
  accent,
  count,
  maxCount,
  variant,
  active,
  dragActive,
  droppable = true,
  email,
  onClick,
  onAssign,
}: {
  label: string;
  accent: string;
  count: number;
  maxCount: number;
  variant: "rep" | "unassigned";
  active: boolean;
  dragActive: boolean;
  droppable?: boolean;
  email?: string | null;
  onClick: () => void;
  onAssign: () => void;
}) {
  const [over, setOver] = React.useState(false);
  const isUnassigned = variant === "unassigned";
  const loadPct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  const initials = isUnassigned
    ? "?"
    : label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");

  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={
        droppable
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!over) setOver(true);
            }
          : undefined
      }
      onDragLeave={droppable ? () => setOver(false) : undefined}
      onDrop={
        droppable
          ? (e) => {
              e.preventDefault();
              setOver(false);
              onAssign();
            }
          : undefined
      }
      title={email ?? label}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: RADIUS.md,
        cursor: "pointer",
        border: over
          ? `1.5px dashed ${isUnassigned ? COLORS.warn : accent}`
          : `1px solid ${active ? (isUnassigned ? COLORS.warn : accent) : dragActive ? COLORS.lineStrong : "transparent"}`,
        background: over
          ? isUnassigned
            ? COLORS.warnBg
            : `${accent}14`
          : active
          ? isUnassigned
            ? COLORS.warnBg
            : `${accent}11`
          : COLORS.bgCard,
        transform: over ? "scale(1.015)" : "none",
        transition: "background .12s, border-color .12s, transform .1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* avatar / pastille */}
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 700,
            color: isUnassigned ? COLORS.warn : "#fff",
            background: isUnassigned ? COLORS.warnBg : accent,
            border: isUnassigned ? `1px dashed ${COLORS.warn}` : `2px solid ${accent}`,
          }}
        >
          {isUnassigned ? <AlertTriangle size={11} /> : initials || "?"}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: active ? 700 : 600,
            color: isUnassigned ? COLORS.warn : COLORS.ink1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: isUnassigned && count > 0 ? COLORS.warn : COLORS.ink2,
            minWidth: 20,
            textAlign: "right",
          }}
        >
          {count}
        </span>
      </div>

      {/* barre de charge */}
      {!isUnassigned && (
        <div style={{ height: 4, borderRadius: 999, background: COLORS.bgSoft, overflow: "hidden" }}>
          <div
            style={{
              width: `${loadPct}%`,
              height: "100%",
              background: accent,
              borderRadius: 999,
              transition: "width .2s",
            }}
          />
        </div>
      )}
    </button>
  );
}
