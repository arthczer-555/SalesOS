"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { AGENT_BY_ID, AGENT_CATEGORY_COLORS } from "@/lib/intel-agents";
import type { Intel, AgentId } from "@/lib/intel-types";
import { dayKey, dayLabel, type GroupMode, type GroupBucket } from "../_helpers";
import { IntelRow } from "./intel-row";

function groupByDay(intels: Intel[]): GroupBucket<Intel>[] {
  const map = new Map<string, Intel[]>();
  for (const i of intels) {
    const k = dayKey(i.created_at);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([k, items]) => ({ key: k, label: dayLabel(items[0].created_at), items }));
}

function groupByAgent(intels: Intel[]): GroupBucket<Intel>[] {
  const map = new Map<string, Intel[]>();
  for (const i of intels) {
    const k = i.agent_id ?? "—";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, items]) => ({
      key: k,
      label: AGENT_BY_ID[k as AgentId]?.name ?? "Inconnu",
      items,
      agentId: k as AgentId,
    }));
}

export function IntelListGrouped({
  intels,
  selectedId,
  onSelect,
  mode,
}: {
  intels: Intel[];
  selectedId: string | null;
  onSelect: (i: Intel) => void;
  mode: GroupMode;
}) {
  const groups = mode === "agent" ? groupByAgent(intels) : groupByDay(intels);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  if (intels.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
        Aucun intel pour ces filtres.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {groups.map((g) => {
        const isCollapsed = collapsed[g.key] ?? false;
        const avgScore = g.items.reduce((s, x) => s + x.score, 0) / Math.max(1, g.items.length);
        const agentDef = g.agentId ? AGENT_BY_ID[g.agentId] : null;
        const sideColor = agentDef ? AGENT_CATEGORY_COLORS[agentDef.category].fg : COLORS.ink4;
        return (
          <div key={g.key} style={{ marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderLeft: `3px solid ${sideColor}`,
                background: COLORS.bgSoft,
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.ink1,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span>{g.label}</span>
              <span style={{ marginLeft: "auto", fontWeight: 500, color: COLORS.ink3, textTransform: "none", letterSpacing: 0 }}>
                {g.items.length} · score moyen {Math.round(avgScore)}
              </span>
            </button>
            {!isCollapsed &&
              g.items.map((i) => (
                <IntelRow key={i.id} intel={i} active={i.id === selectedId} onClick={() => onSelect(i)} />
              ))}
          </div>
        );
      })}
    </div>
  );
}
