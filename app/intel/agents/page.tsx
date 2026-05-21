"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Target, FileText } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { Agent } from "@/lib/intel-types";
import { useIntelAgents, toggleAgent, runAgent } from "@/lib/hooks/use-intel-agents";
import { AgentCard } from "./_components/agent-card";
import { AgentConfigDrawer } from "./_components/agent-config-drawer";
import { IcpTargetsDrawer } from "@/components/icp-targets-drawer";
import { AgentLogsDrawer } from "./_components/agent-logs-drawer";
import type { AgentLogsResponse } from "@/app/api/intel/agents/logs/route";

const errorCountFetcher = async (url: string): Promise<{ errorCount24h: number }> => {
  const r = await fetch(url);
  if (!r.ok) return { errorCount24h: 0 };
  const data = (await r.json()) as AgentLogsResponse;
  return { errorCount24h: data.errorCount24h };
};

export default function IntelAgentsPage() {
  const { agents, isLoading, error, reload } = useIntelAgents();
  const [running, setRunning] = React.useState<Record<string, boolean>>({});
  const [configAgent, setConfigAgent] = React.useState<Agent | null>(null);
  const [globalOpen, setGlobalOpen] = React.useState(false);
  const [logsOpen, setLogsOpen] = React.useState(false);

  // Poll error count for the badge — minimal payload (limit=1)
  const { data: errorStats } = useSWR<{ errorCount24h: number }>(
    "/api/intel/agents/logs?status=error&limit=1",
    errorCountFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  const errorCount24h = errorStats?.errorCount24h ?? 0;

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await toggleAgent(id, enabled);
      reload();
    } catch {
      /* noop */
    }
  }

  async function handleRun(id: string) {
    setRunning((s) => ({ ...s, [id]: true }));
    try {
      await runAgent(id);
      reload();
    } finally {
      setRunning((s) => ({ ...s, [id]: false }));
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: COLORS.bgPage,
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 20px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href="/intel"
          aria-label="Retour Market Intel"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={13} /> Market Intel
        </Link>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>Agents</h1>
          <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
            Configure les sources qui produisent des intels.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLogsOpen(true)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            border: `1px solid ${errorCount24h > 0 ? COLORS.err : COLORS.line}`,
            background: errorCount24h > 0 ? COLORS.errBg : COLORS.bgCard,
            color: errorCount24h > 0 ? COLORS.err : COLORS.ink1,
            cursor: "pointer",
            position: "relative",
          }}
        >
          <FileText size={13} /> Logs
          {errorCount24h > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 999,
                background: COLORS.err,
                color: "white",
                minWidth: 16,
                textAlign: "center",
              }}
              aria-label={`${errorCount24h} erreurs dans les 24h`}
            >
              {errorCount24h}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setGlobalOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink1,
            cursor: "pointer",
          }}
        >
          <Target size={13} /> Cibles globales (ICP)
        </button>
      </div>

      {/* Grid */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {error && <div style={{ color: COLORS.err, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {isLoading && agents.length === 0 ? (
            <div style={{ color: COLORS.ink3, fontSize: 13 }}>Chargement…</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: 16,
              }}
            >
              {agents.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  isRunning={!!running[a.id] || a.last_run_status === "running"}
                  onToggle={() => handleToggle(a.id, !a.enabled)}
                  onRun={() => handleRun(a.id)}
                  onConfigure={() => setConfigAgent(a)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {configAgent && (
        <AgentConfigDrawer
          agent={configAgent}
          onClose={() => setConfigAgent(null)}
          onSaved={reload}
          onOpenGlobalSettings={() => {
            setConfigAgent(null);
            setGlobalOpen(true);
          }}
        />
      )}
      <IcpTargetsDrawer open={globalOpen} onClose={() => setGlobalOpen(false)} />
      <AgentLogsDrawer open={logsOpen} onClose={() => setLogsOpen(false)} />
    </div>
  );
}
