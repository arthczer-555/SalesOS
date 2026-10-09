"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Bot, Inbox, Plus, Search, Sparkles, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { agentsApi, useAgents } from "@/lib/hooks/use-agents";
import { useToast } from "@/components/ui/toast";
import type { AgentSummary } from "@/lib/agents/types";
import { AgentCard } from "./agent-card";
import { AGENT_TEMPLATES } from "./templates";
import { AgentAvatar, Callout, timeUntil } from "./ui";

type Tab = "mine" | "received" | "team";

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 18px", minWidth: 0, flex: "1 1 160px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: COLORS.ink3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.02em", marginTop: 4, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function StatsStrip({ agents }: { agents: AgentSummary[] }) {
  const active = agents.filter((a) => a.status === "active");
  const drafts = agents.filter((a) => a.status === "draft").length;
  const paused = agents.filter((a) => a.status === "paused").length;
  const next = active.filter((a) => a.next_run_at).sort((a, b) => (a.next_run_at! < b.next_run_at! ? -1 : 1))[0];
  const runs = agents.reduce((s, a) => s + (a.run_count ?? 0), 0);
  const failing = agents.filter((a) => a.last_run_status === "error" && a.status === "active").length;
  return (
    <div className="ag-card" style={{ display: "flex", flexWrap: "wrap", marginTop: 22 }}>
      <Stat label="Active" value={active.length} sub={[paused && `${paused} paused`, drafts && `${drafts} draft${drafts > 1 ? "s" : ""}`].filter(Boolean).join(" · ") || "All set"} />
      <Stat
        label="Next delivery"
        value={next ? timeUntil(next.next_run_at) : "-"}
        sub={next ? `${next.emoji} ${next.name}` : "No active agent"}
      />
      <Stat label="Runs" value={runs} sub="Since you created them" />
      <Stat
        label="Health"
        value={failing ? <span style={{ color: COLORS.err }}>{failing} failing</span> : <span style={{ color: COLORS.ok }}>All good</span>}
        sub={failing ? "Open the agent to see why" : "Last runs succeeded"}
      />
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="ag-grid-cards">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ag-card" style={{ padding: 18, minHeight: 196 }}>
          <div className="ag-shimmer" style={{ width: 44, height: 44, borderRadius: 13 }} />
          <div className="ag-shimmer" style={{ width: "55%", height: 14, marginTop: 16 }} />
          <div className="ag-shimmer" style={{ width: "90%", height: 11, marginTop: 10 }} />
          <div className="ag-shimmer" style={{ width: "70%", height: 11, marginTop: 7 }} />
        </div>
      ))}
    </div>
  );
}

function NewAgentCard() {
  return (
    <Link
      href="/agents/new"
      className="ag-card ag-card-link ag-card-draft"
      style={{ padding: 18, minHeight: 196, alignItems: "center", justifyContent: "center", textAlign: "center", gap: 10, background: "transparent" }}
    >
      <span style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", background: COLORS.brandTint, color: COLORS.brand }}>
        <Plus size={20} />
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>New agent</span>
      <span style={{ fontSize: 12.5, color: COLORS.ink3, maxWidth: 220 }}>Describe it in a sentence, we build the rest.</span>
    </Link>
  );
}

function EmptyHero() {
  return (
    <div
      className="ag-card"
      style={{
        padding: "44px 24px",
        textAlign: "center",
        background: "radial-gradient(120% 90% at 50% 0%, #fff5f9 0%, #fff 60%)",
      }}
    >
      <div className="ag-designing-orb" style={{ margin: "0 auto 18px", animationDuration: "9s" }}>
        <span style={{ animationDuration: "9s" }}>🤖</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.02em" }}>Create your first agent</h2>
      <p style={{ margin: "8px auto 20px", fontSize: 13.5, color: COLORS.ink2, maxWidth: 460, lineHeight: 1.6 }}>
        Tell it what you need to know and when. It reads HubSpot, Claap, Slack, client files and more, then posts a ready-to-read update to Slack, on schedule.
      </p>
      <Link href="/agents/new" className="ag-btn ag-btn-primary ag-btn-lg">
        <Sparkles size={15} /> Create an agent
      </Link>
    </div>
  );
}

const EMPTY_TEXT: Record<Exclude<Tab, "mine">, string> = {
  received:
    "Nothing from your teammates lands in your DMs yet. When someone sends you an agent, or you subscribe to one in the Team tab, it shows up here.",
  team: "No teammate has shared an agent yet. Agents are personal until their creator turns on \"Share with the team\".",
};

export function AgentsHome() {
  const { mine, received, team, error, isLoading, mutate } = useAgents();
  const { toast } = useToast();
  const onSubscribe = async (agent: AgentSummary, active: boolean) => {
    try {
      await agentsApi(`/api/agents/${agent.id}/subscribe`, "POST", { active });
      await mutate();
      toast(active ? `Subscribed to ${agent.name}: it now runs for you and lands in your DMs. Find it in Received.` : `Unsubscribed from ${agent.name}.`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the subscription", "error");
    }
  };
  const [tab, setTab] = React.useState<Tab>("mine");
  const [query, setQuery] = React.useState("");

  const list = tab === "mine" ? mine : tab === "received" ? received : team;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((a) => [a.name, a.tagline, a.owner_name].some((v) => v?.toLowerCase().includes(q)))
    : list;

  return (
    <div className="ag-page">
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.brandDark,
              background: COLORS.brandTint,
              borderRadius: 999,
              padding: "4px 10px",
            }}
          >
            <Bot size={13} /> AI agents
          </span>
          <h1 style={{ margin: "10px 0 0", fontSize: 28, fontWeight: 750, letterSpacing: "-0.025em", color: COLORS.ink0 }}>Agents</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: COLORS.ink2, maxWidth: 620, lineHeight: 1.55 }}>
            Recurring updates on autopilot. Each agent reads your tools, writes the message and posts it to Slack at the right time.
          </p>
        </div>
        <Link href="/agents/new" className="ag-btn ag-btn-primary ag-btn-lg">
          <Plus size={16} /> New agent
        </Link>
      </div>

      {mine.length > 0 && <StatsStrip agents={mine} />}

      {/* Onglets + recherche */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 28,
          marginBottom: 16,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div className="ag-tabs" role="tablist">
          <button type="button" role="tab" className="ag-tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
            <Bot size={15} /> My agents <span className="ag-tab-count">{mine.length}</span>
          </button>
          <button type="button" role="tab" className="ag-tab" aria-selected={tab === "received"} onClick={() => setTab("received")}>
            <Inbox size={15} /> Received <span className="ag-tab-count">{received.length}</span>
          </button>
          <button type="button" role="tab" className="ag-tab" aria-selected={tab === "team"} onClick={() => setTab("team")}>
            <Users size={15} /> Team <span className="ag-tab-count">{team.length}</span>
          </button>
        </div>
        {list.length > 3 && (
          <div style={{ position: "relative", width: 240, marginBottom: 8 }}>
            <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: COLORS.ink4 }} />
            <input className="ag-input" style={{ paddingLeft: 32, paddingBlock: 7 }} placeholder="Search agents" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {error ? (
        <Callout tone="err" icon={AlertTriangle}>
          <b>Could not load agents.</b> {error.message}
        </Callout>
      ) : isLoading ? (
        <SkeletonGrid />
      ) : tab === "mine" && mine.length === 0 ? (
        <EmptyHero />
      ) : filtered.length === 0 ? (
        <div className="ag-card" style={{ padding: "36px 20px", textAlign: "center", color: COLORS.ink3, fontSize: 13.5 }}>
          {q ? `No agent matches "${query}".` : tab !== "mine" && EMPTY_TEXT[tab]}
        </div>
      ) : (
        <div className="ag-grid-cards">
          {filtered.map((a) => (
            <AgentCard key={a.id} agent={a} showOwner={tab !== "mine"} onSubscribe={onSubscribe} />
          ))}
          {tab === "mine" && !q && <NewAgentCard />}
        </div>
      )}

      {tab === "received" && received.length > 0 && (
        <p className="ag-hint" style={{ marginTop: 12 }}>
          Agents your teammates send you, and the ones you subscribed to. They land in your Slack DMs on their schedule. Open one to see the messages you got.
        </p>
      )}

      {tab === "team" && team.length > 0 && (
        <p className="ag-hint" style={{ marginTop: 12 }}>
          Agents your teammates chose to share. Try one once, or subscribe to get it in your DMs on its schedule: it always runs with your own data. Your own agents stay personal until you turn on &quot;Share with the team&quot;. Their messages stay private, and so do yours.
        </p>
      )}

      {/* Galerie de modèles */}
      <div style={{ marginTop: 40 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>Start from a template</h2>
          <span style={{ fontSize: 12.5, color: COLORS.ink3 }}>Pick one, adjust it in plain words.</span>
        </div>
        <div className="ag-grid-templates">
          {AGENT_TEMPLATES.map((t) => (
            <Link key={t.key} href={`/agents/new?template=${t.key}`} className="ag-template">
              <AgentAvatar emoji={t.emoji} color={t.color} size={38} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>{t.name}</span>
                <span style={{ display: "block", fontSize: 12, color: COLORS.ink3, lineHeight: 1.45, marginTop: 2 }}>{t.tagline}</span>
                <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.ink4, marginTop: 6 }}>
                  {t.category}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
