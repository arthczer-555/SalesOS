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
  // true quand on survole cette boîte département en glissant une carte : la
  // boîte s'illumine pour signaler "lâche ici pour mettre la carte dans ce dept".
  dropActive?: boolean;
};
export type ClusterNodeType = Node<ClusterNodeData, "cluster">;

// Boîte de fond : entité (grande carte "entreprise" draggable, avec header
// nommé) ou département (sous-zone intérieure colorée). Les personnes flottent
// par-dessus.
function ClusterNodeImpl({ data }: NodeProps<ClusterNodeType>) {
  if (data.kind === "entity") {
    // active = on glisse une carte hors de sa sous-zone département, ici, pour la
    // retirer de son département (retour en zone neutre de l'entité).
    const active = !!data.dropActive;
    return (
      <div
        style={{
          width: data.width,
          height: data.height,
          borderRadius: 18,
          border: `${active ? 2 : 1.5}px ${active ? "dashed" : "solid"} ${active ? COLORS.brand : COLORS.lineStrong}`,
          background: COLORS.bgCard,
          boxShadow: active ? `0 0 0 4px ${COLORS.brandTint}` : SHADOWS.card,
          transition: "box-shadow .12s, border-color .12s",
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
            background: active ? COLORS.brandTint : COLORS.bgSoft,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            pointerEvents: "none",
          }}
        >
          <Building2 size={15} style={{ color: active ? COLORS.brand : COLORS.ink2 }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>{data.label}</span>
          {active && (
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.brand }}>· drop to remove from team</span>
          )}
        </div>
      </div>
    );
  }

  // Département (sous-zone)
  const fg = data.fg ?? COLORS.ink2;
  const bg = data.bg ?? COLORS.bgSoft;
  const border = data.border ?? COLORS.lineStrong;
  const active = !!data.dropActive;
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        borderRadius: 12,
        border: `${active ? 2 : 1}px ${active ? "dashed" : "solid"} ${active ? fg : border}`,
        background: bg,
        boxShadow: active ? `0 0 0 4px ${bg}, inset 0 0 0 9999px ${fg}14` : "none",
        transition: "box-shadow .12s, border-color .12s",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          margin: 8,
          padding: "2px 9px",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: active ? "#fff" : fg,
          background: active ? fg : COLORS.bgCard,
          border: `1px solid ${active ? fg : border}`,
          borderRadius: 999,
        }}
      >
        {data.label}
        {active && <span style={{ textTransform: "none", fontWeight: 600 }}>· drop to assign</span>}
      </div>
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeImpl);
