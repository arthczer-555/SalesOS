"use client";

import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";
import { Building2 } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";

export type ClusterKind = "entity" | "department";

export type ClusterNodeData = {
  label: string;
  width: number;
  height: number;
  kind: ClusterKind;
  fg?: string;
  bg?: string;
  border?: string;
};
export type ClusterNodeType = Node<ClusterNodeData, "cluster">;

// Boîte de fond : entité (grande carte "entreprise" draggable, avec header
// nommé) ou département (sous-zone intérieure colorée). Les personnes flottent
// par-dessus.
function ClusterNodeImpl({ data }: NodeProps<ClusterNodeType>) {
  if (data.kind === "entity") {
    return (
      <div
        style={{
          width: data.width,
          height: data.height,
          borderRadius: 18,
          border: `1.5px solid ${COLORS.lineStrong}`,
          background: COLORS.bgCard,
          boxShadow: SHADOWS.card,
          cursor: "move",
        }}
      >
        {/* Header "entreprise" */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 38,
            padding: "0 14px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            pointerEvents: "none",
          }}
        >
          <Building2 size={15} style={{ color: COLORS.ink2 }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>{data.label}</span>
        </div>
      </div>
    );
  }

  // Département (sous-zone)
  const fg = data.fg ?? COLORS.ink2;
  const bg = data.bg ?? COLORS.bgSoft;
  const border = data.border ?? COLORS.lineStrong;
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: bg,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "inline-block",
          margin: 8,
          padding: "2px 9px",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: fg,
          background: COLORS.bgCard,
          border: `1px solid ${border}`,
          borderRadius: 999,
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeImpl);
