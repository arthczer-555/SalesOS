"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import type { ScopeCompany } from "./types";

// Mini-stats du Board, calculées côté client depuis les companies visibles.
export function BoardStats({
  visible,
  totalAll,
  salesCount,
  selectedRep,
}: {
  visible: ScopeCompany[];
  totalAll: number;
  salesCount: number;
  selectedRep: string | null;
}) {
  const sectors = topCounts(visible.map((c) => c.sector));
  const platforms = topCounts(visible.map((c) => c.current_coaching_platform));
  const avg = salesCount > 0 ? Math.round((totalAll / salesCount) * 10) / 10 : 0;

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <Tile
        label={selectedRep ? "Companies (sales)" : "Companies"}
        value={selectedRep ? `${visible.length}` : `${totalAll}`}
        sub={selectedRep ? `sur ${totalAll}` : undefined}
      />
      <Divider />
      <Tile label="Sales" value={`${salesCount}`} />
      <Divider />
      <Tile label="⌀ par sales" value={`${avg}`} />

      {sectors.length > 0 && (
        <>
          <Divider />
          <Distribution title="Secteurs" items={sectors} />
        </>
      )}
      {platforms.length > 0 && (
        <>
          <Divider />
          <Distribution title="Plateformes" items={platforms} />
        </>
      )}
    </div>
  );
}

function topCounts(values: Array<string | null>, max = 4): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t) continue;
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max);
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink0, lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontSize: 10, color: COLORS.ink4 }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );
}

function Distribution({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {title}
      </span>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {items.map((it) => (
          <span
            key={it.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              borderRadius: 999,
              background: COLORS.bgSoft,
              border: `1px solid ${COLORS.line}`,
              fontSize: 11,
              color: COLORS.ink2,
              maxWidth: 160,
            }}
          >
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
            <span style={{ fontWeight: 700, color: COLORS.ink1 }}>{it.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 28, background: COLORS.line, flexShrink: 0 }} />;
}
