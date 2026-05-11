"use client";

import * as React from "react";
import { Trash2, Search } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentList } from "@/lib/intel-types";

export function SavedListsSidebar({
  lists,
  selectedId,
  onSelect,
  onDelete,
}: {
  lists: EnrichmentList[];
  selectedId: string | null;
  onSelect: (l: EnrichmentList) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const filtered = lists.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        background: COLORS.bgCard,
        borderRight: `1px solid ${COLORS.line}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: 16, borderBottom: `1px solid ${COLORS.line}` }}>
        <h3
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: COLORS.ink3,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 8px 0",
          }}
        >
          Listes sauvegardées
        </h3>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer…"
            style={{
              width: "100%",
              paddingLeft: 30,
              paddingRight: 10,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 6,
              border: `1px solid ${COLORS.line}`,
              fontSize: 12,
              outline: "none",
              background: COLORS.bgSoft,
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {filtered.length === 0 && (
          <p style={{ padding: 16, fontSize: 11, color: COLORS.ink3, margin: 0 }}>Aucune liste sauvegardée.</p>
        )}
        {filtered.map((l) => {
          const active = l.id === selectedId;
          return (
            <div
              key={l.id}
              onClick={() => onSelect(l)}
              role="button"
              tabIndex={0}
              style={{
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 8,
                cursor: "pointer",
                background: active ? COLORS.brandTint : "transparent",
                borderLeft: active ? `2px solid ${COLORS.brand}` : "2px solid transparent",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
                  {l.source} · {(l.results ?? []).length} profils
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Supprimer cette liste ?")) onDelete(l.id);
                }}
                aria-label="Supprimer"
                style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer", padding: 2 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
