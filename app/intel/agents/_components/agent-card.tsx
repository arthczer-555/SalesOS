"use client";

import * as React from "react";
import Link from "next/link";
import { Play, RefreshCw, ChevronRight, AlertCircle, CheckCircle2, Settings } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { AGENT_CATEGORY_COLORS } from "@/lib/intel-agents";
import type { Agent } from "@/lib/intel-types";
import { agentIcon } from "../../_components/agent-badge";
import { timeAgo } from "../../_helpers";

const STATUS_LABEL: Record<Agent["status"], { label: string; fg: string; bg: string }> = {
  active: { label: "Actif", fg: COLORS.ok, bg: COLORS.okBg },
  partial: { label: "Partiel", fg: COLORS.warn, bg: COLORS.warnBg },
  inactive: { label: "Inactif", fg: COLORS.ink3, bg: COLORS.bgSoft },
};

export function AgentCard({
  agent,
  onToggle,
  onRun,
  onConfigure,
  isRunning,
}: {
  agent: Agent;
  onToggle: () => void;
  onRun: () => void;
  onConfigure: () => void;
  isRunning: boolean;
}) {
  const Icon = agentIcon(agent);
  const cat = AGENT_CATEGORY_COLORS[agent.category];
  const stat = STATUS_LABEL[agent.status];

  return (
    <div
      className="ds-card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: agent.enabled ? 1 : 0.7,
      }}
    >
      {/* Top */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: cat.bg,
            color: cat.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>{agent.name}</h3>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 99,
                color: stat.fg,
                background: stat.bg,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {stat.label}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 99,
                color: cat.fg,
                background: cat.bg,
              }}
            >
              {cat.label}
            </span>
          </div>
          <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>{agent.description}</p>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={agent.enabled}
            onChange={onToggle}
            style={{ accentColor: COLORS.brand, width: 16, height: 16 }}
          />
        </label>
      </div>

      {/* Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          padding: "8px 0",
          borderTop: `1px solid ${COLORS.line}`,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <Metric label="Coût" value={agent.estimatedCreditsPerRun} />
        <Metric
          label="Cette semaine"
          value={`${agent.weeklyIntelsCount ?? 0} intel${(agent.weeklyIntelsCount ?? 0) > 1 ? "s" : ""}`}
        />
        <Metric label="Dernier run" value={agent.last_run_at ? timeAgo(agent.last_run_at) : "—"} />
      </div>

      {/* Last run status */}
      {agent.last_run_status && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.ink2 }}>
          {agent.last_run_status === "ok" ? (
            <CheckCircle2 size={12} color={COLORS.ok} />
          ) : agent.last_run_status === "error" ? (
            <AlertCircle size={12} color={COLORS.err} />
          ) : (
            <RefreshCw size={12} color={COLORS.warn} />
          )}
          <span>
            {agent.last_run_status === "ok"
              ? `Dernière exécution OK · ${agent.last_run_signals_count} intels`
              : agent.last_run_status === "error"
                ? `Erreur : ${agent.last_run_error?.slice(0, 80) ?? "inconnue"}`
                : "En cours…"}
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onConfigure}
          style={{
            flex: 1,
            minWidth: 110,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.brand}`,
            background: COLORS.brandTint,
            color: COLORS.brand,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Settings size={12} /> Configurer
        </button>
        {agent.runEndpoint && (
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning || !agent.enabled}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              fontSize: 12,
              fontWeight: 500,
              cursor: isRunning ? "wait" : "pointer",
            }}
          >
            {isRunning ? (
              <>
                <RefreshCw size={12} className="animate-spin" /> En cours
              </>
            ) : (
              <>
                <Play size={12} /> Lancer
              </>
            )}
          </button>
        )}
        <Link
          href={`/intel?agent=${agent.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink1,
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Intels <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.ink0 }}>{value}</span>
    </div>
  );
}
