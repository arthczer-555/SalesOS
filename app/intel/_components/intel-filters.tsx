"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { AGENTS } from "@/lib/intel-agents";
import type { AgentId, IntelFilters } from "@/lib/intel-types";

const PERIODS: { value: NonNullable<IntelFilters["period"]>; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "all", label: "Tout" },
];

const STATUS: { value: NonNullable<IntelFilters["status"]>; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "unread", label: "Non lus" },
  { value: "actionable", label: "Actionnables" },
  { value: "archived", label: "Archivés" },
];

export function IntelFiltersBar({
  filters,
  onChange,
}: {
  filters: IntelFilters;
  onChange: (next: IntelFilters) => void;
}) {
  const [agentMenuOpen, setAgentMenuOpen] = React.useState(false);
  const agentMenuRef = React.useRef<HTMLDivElement>(null);
  const selectedAgents = filters.agents ?? [];

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!agentMenuRef.current?.contains(e.target as Node)) setAgentMenuOpen(false);
    }
    if (agentMenuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [agentMenuOpen]);

  const toggleAgent = (id: AgentId) => {
    const has = selectedAgents.includes(id);
    onChange({
      ...filters,
      agents: has ? selectedAgents.filter((a) => a !== id) : [...selectedAgents, id],
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 20px",
        borderBottom: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        flexWrap: "wrap",
      }}
    >
      {/* Agents multi-select */}
      <div ref={agentMenuRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setAgentMenuOpen((o) => !o)}
          style={chipStyle(selectedAgents.length > 0)}
        >
          Agents{selectedAgents.length > 0 ? ` (${selectedAgents.length})` : ""}
          <ChevronDown size={12} style={{ marginLeft: 4 }} />
        </button>
        {agentMenuOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: 220,
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 8,
              boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
              padding: 8,
              zIndex: 20,
            }}
          >
            {AGENTS.map((a) => {
              const selected = selectedAgents.includes(a.id);
              return (
                <label
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: selected ? COLORS.brandTintSoft : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleAgent(a.id)}
                    style={{ accentColor: COLORS.brand }}
                  />
                  <span style={{ fontSize: 12, color: COLORS.ink1 }}>{a.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Score min */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.ink2 }}>
        Score ≥
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={filters.scoreMin ?? 0}
          onChange={(e) => onChange({ ...filters, scoreMin: parseInt(e.target.value, 10) || 0 })}
          style={{
            width: 56,
            padding: "4px 6px",
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            fontSize: 12,
          }}
        />
      </label>

      {/* Period */}
      <div style={{ display: "flex", gap: 0, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2 }}>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange({ ...filters, period: p.value })}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
              background: filters.period === p.value ? COLORS.brand : "transparent",
              color: filters.period === p.value ? "white" : COLORS.ink2,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Status */}
      <div style={{ display: "flex", gap: 0, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2 }}>
        {STATUS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange({ ...filters, status: s.value })}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
              background: filters.status === s.value ? COLORS.ink0 : "transparent",
              color: filters.status === s.value ? "white" : COLORS.ink2,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Reset */}
      {(selectedAgents.length > 0 || (filters.scoreMin ?? 0) > 0 || filters.period !== "all" || (filters.status && filters.status !== "all") || filters.q) && (
        <button
          type="button"
          onClick={() =>
            onChange({ agents: [], scoreMin: 0, period: "all", status: "all", q: "" })
          }
          style={{ ...chipStyle(false), color: COLORS.ink3 }}
        >
          <X size={12} /> Réinitialiser
        </button>
      )}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 99,
    border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
    background: active ? COLORS.brandTint : COLORS.bgCard,
    color: active ? COLORS.brand : COLORS.ink2,
    cursor: "pointer",
  };
}
