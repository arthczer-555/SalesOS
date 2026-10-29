"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { KUNA_STATUS_LABELS, type ConditionLevel, type KunaStatus } from "@/lib/deals/kuna";

// Palette KUNA : A (hypothèse) est la plus sombre pour sauter aux yeux, la
// lettre reste toujours visible (pas d'info portée par la couleur seule).
export const KUNA_STYLE: Record<KunaStatus | "off", React.CSSProperties> = {
  K: { background: "#15803d", color: "#fff" },
  U: { background: "#f1f1f4", color: "#52525b", outline: "1px dashed #a1a1aa", outlineOffset: -1 },
  N: { background: "#f59e0b", color: "#451a03" },
  A: { background: "#b91c1c", color: "#fff" },
  off: { background: "#fff", color: "#a1a1aa", outline: `1px solid ${COLORS.lineStrong}`, outlineOffset: -1 },
};

// Niveau d'une condition du Path to close (et du threading) : vert = remplie,
// orange = à moitié (2 contacts actifs sur 3), sinon neutre avec pastille rouge.
export const LEVEL_STYLE: Record<ConditionLevel, { solid: string; onSolid: string; tileBg: string; tileBorder: string; text: string }> = {
  met: { solid: "#15803d", onSolid: "#fff", tileBg: "#f0fdf4", tileBorder: "#bbf7d0", text: "#166534" },
  partial: { solid: "#f59e0b", onSolid: "#451a03", tileBg: "#fffbeb", tileBorder: "#fde68a", text: "#92400e" },
  missing: { solid: "#b91c1c", onSolid: "#fff", tileBg: COLORS.bgCard, tileBorder: COLORS.line, text: COLORS.ink1 },
};

export function KunaChip({
  status,
  off = false,
  size = 22,
  label,
}: {
  status: KunaStatus;
  off?: boolean;
  size?: number;
  label?: string;
}) {
  return (
    <span
      title={off ? undefined : KUNA_STATUS_LABELS[status]}
      aria-label={off ? undefined : KUNA_STATUS_LABELS[status]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: size,
        height: size,
        padding: label ? "0 7px" : 0,
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
        ...KUNA_STYLE[off ? "off" : status],
      }}
    >
      {label ?? status}
    </span>
  );
}

// Titre de bloc en casse normale + sous-titre gris (les nouveaux blocs de la
// fiche n'utilisent pas les petits labels en capitales).
export function BlockTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: COLORS.ink0, letterSpacing: "-0.005em" }}>{title}</h3>
        {subtitle && <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.ink2, lineHeight: 1.45 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
