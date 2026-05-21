"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import type { WatchSalesRep } from "@/app/api/watchlist/sales-reps/route";

export function SalesStrip({
  reps,
  selectedRep,
  onSelect,
  isLoading,
}: {
  reps: WatchSalesRep[];
  selectedRep: string | null;
  onSelect: (name: string | null) => void;
  isLoading: boolean;
}) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: `1px solid ${COLORS.line}`,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
        }}
      >
        Sales reps ({reps.length})
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {isLoading && reps.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: COLORS.ink3 }}>Chargement…</div>
        ) : reps.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: COLORS.ink3 }}>
            Aucun sales rep. Ajoute des comptes ICP avec un owner.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <li>
              <button
                type="button"
                onClick={() => onSelect(null)}
                style={repButton(selectedRep === null)}
              >
                <span style={{ flex: 1, textAlign: "left" }}>Tous</span>
                <span style={countPill()}>{reps.reduce((acc, r) => acc + r.account_count, 0)}</span>
              </button>
            </li>
            {reps.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.name)}
                  style={repButton(selectedRep?.toLowerCase() === r.name.toLowerCase())}
                  title={r.email ?? r.name}
                >
                  <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.name}
                  </span>
                  <span style={countPill()}>{r.account_count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function repButton(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "8px 10px",
    fontSize: 12,
    borderRadius: 8,
    border: `1px solid ${active ? COLORS.brand : "transparent"}`,
    background: active ? `${COLORS.brand}11` : "transparent",
    color: active ? COLORS.brand : COLORS.ink1,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    gap: 8,
  };
}

function countPill(): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 999,
    background: COLORS.bgSoft,
    color: COLORS.ink2,
    fontWeight: 600,
    minWidth: 22,
    textAlign: "center",
  };
}
