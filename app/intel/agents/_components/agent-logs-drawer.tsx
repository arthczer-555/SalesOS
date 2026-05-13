"use client";

import * as React from "react";
import useSWR from "swr";
import { X, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { AGENTS } from "@/lib/intel-agents";
import type { AgentLogsResponse, AgentRunLog } from "@/app/api/intel/agents/logs/route";

const AGENT_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a.name]),
);

type StatusFilter = "all" | "error" | "ok";
type AgentFilter = "all" | string;

const fetcher = async (url: string): Promise<AgentLogsResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<AgentLogsResponse>;
};

export function AgentLogsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("error");
  const [agentFilter, setAgentFilter] = React.useState<AgentFilter>("all");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (agentFilter !== "all") params.set("agent", agentFilter);
  params.set("limit", "200");

  const url = open ? `/api/intel/agents/logs?${params.toString()}` : null;
  const { data, error, isLoading, mutate } = useSWR<AgentLogsResponse>(url, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 880,
          maxWidth: "100%",
          background: COLORS.bgCard,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
              Logs des agents
            </h2>
            <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
              Historique de chaque exécution (manuelle + cron). Auto-refresh 30s.
            </p>
          </div>
          {data && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <ErrorBadge count={data.errorCount24h} label="24h" />
              <ErrorBadge count={data.errorCount7d} label="7j" />
            </div>
          )}
          <button
            type="button"
            onClick={() => mutate()}
            aria-label="Recharger"
            style={iconBtn()}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </header>

        <div
          style={{
            padding: "10px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <FilterChip
            label="Erreurs"
            active={statusFilter === "error"}
            onClick={() => setStatusFilter("error")}
            tone="err"
          />
          <FilterChip
            label="Tout"
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <FilterChip
            label="Succès"
            active={statusFilter === "ok"}
            onClick={() => setStatusFilter("ok")}
            tone="ok"
          />
          <span style={{ width: 1, background: COLORS.line, height: 18, margin: "0 6px" }} />
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              border: `1px solid ${COLORS.line}`,
              borderRadius: 6,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              cursor: "pointer",
            }}
          >
            <option value="all">Tous les agents</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {error && (
            <div style={{ padding: 16, color: COLORS.err, fontSize: 13 }}>
              Erreur de chargement : {String(error)}
            </div>
          )}
          {isLoading && !data && (
            <div style={{ padding: 16, color: COLORS.ink3, fontSize: 13 }}>Chargement…</div>
          )}
          {data && data.logs.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
              Aucun run pour ce filtre.
            </div>
          )}
          {data && data.logs.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {data.logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  expanded={expanded === log.id}
                  onToggle={() => setExpanded((cur) => (cur === log.id ? null : log.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: AgentRunLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const agentName = AGENT_NAME_BY_ID[log.agent_id] ?? log.agent_id;
  const isError = log.status === "error";
  const Icon = isError ? AlertCircle : log.status === "ok" ? CheckCircle2 : Clock;
  const iconColor = isError ? COLORS.err : log.status === "ok" ? COLORS.ok : COLORS.warn;

  return (
    <li
      style={{
        borderBottom: `1px solid ${COLORS.line}`,
        background: isError ? "#fff8f8" : COLORS.bgCard,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          textAlign: "left",
          padding: "10px 20px",
          cursor: log.error ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
          color: COLORS.ink1,
        }}
      >
        <Icon size={14} color={iconColor} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 90, color: COLORS.ink3 }}>
          {new Date(log.started_at).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span style={{ minWidth: 140, fontWeight: 600, color: COLORS.ink0 }}>{agentName}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 4,
            background: log.triggered_by === "cron" ? COLORS.infoBg : COLORS.brandTint,
            color: log.triggered_by === "cron" ? COLORS.info : COLORS.brand,
          }}
        >
          {log.triggered_by}
        </span>
        {log.user_name && (
          <span style={{ color: COLORS.ink3, fontSize: 11 }}>{log.user_name}</span>
        )}
        <span style={{ flex: 1 }} />
        {log.duration_ms != null && (
          <span style={{ color: COLORS.ink3, fontSize: 11 }}>{formatDuration(log.duration_ms)}</span>
        )}
        <span
          style={{
            minWidth: 80,
            textAlign: "right",
            color: log.signals_count > 0 ? COLORS.ok : COLORS.ink4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {log.signals_count} intel{log.signals_count > 1 ? "s" : ""}
        </span>
      </button>
      {expanded && log.error && (
        <pre
          style={{
            margin: 0,
            padding: "10px 20px 14px 46px",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            color: COLORS.err,
            background: "#fff8f8",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {log.error}
        </pre>
      )}
    </li>
  );
}

function ErrorBadge({ count, label }: { count: number; label: string }) {
  const isErr = count > 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        background: isErr ? COLORS.errBg : COLORS.okBg,
        color: isErr ? COLORS.err : COLORS.ok,
        fontWeight: 600,
      }}
    >
      <AlertCircle size={11} />
      {count} erreur{count > 1 ? "s" : ""} / {label}
    </span>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "err" | "ok";
}) {
  const activeBg = tone === "err" ? COLORS.errBg : tone === "ok" ? COLORS.okBg : COLORS.brandTint;
  const activeFg = tone === "err" ? COLORS.err : tone === "ok" ? COLORS.ok : COLORS.brand;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        border: `1px solid ${active ? activeFg : COLORS.line}`,
        background: active ? activeBg : COLORS.bgCard,
        color: active ? activeFg : COLORS.ink2,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    padding: 6,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink2,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m${rs.toString().padStart(2, "0")}s`;
}
