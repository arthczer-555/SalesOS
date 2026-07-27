import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

export function StatPill({
  label,
  value,
  trend,
  trendDirection,
  className = "",
  style,
  onClick,
  active = false,
  title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  trend?: React.ReactNode;
  trendDirection?: "up" | "down" | "flat";
  className?: string;
  style?: React.CSSProperties;
  /** Rend la pastille cliquable (filtre, drill-down…). */
  onClick?: () => void;
  /** État sélectionné, seulement pertinent avec `onClick`. */
  active?: boolean;
  title?: string;
}) {
  const trendColor =
    trendDirection === "up"
      ? COLORS.ok
      : trendDirection === "down"
        ? COLORS.err
        : COLORS.ink3;
  const body = (
    <>
      <span className="ds-kpi-label">{label}</span>
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
        <span className="ds-kpi-num">{value}</span>
        {trend ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: trendColor }}>{trend}</span>
        ) : null}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className={`ds-stat-pill ${className}`.trim()} style={style} title={title}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`ds-stat-pill ds-stat-pill-action ${active ? "ds-stat-pill-active" : ""} ${className}`.trim()}
      style={{ textAlign: "left", ...style }}
    >
      {body}
    </button>
  );
}
