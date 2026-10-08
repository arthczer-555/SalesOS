"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Bell, BellRing, CalendarClock, Hash, Loader2, MessageSquare, Play, Puzzle, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { describeSchedule, shortSchedule } from "@/lib/agents/schedule";
import type { AgentSummary } from "@/lib/agents/types";
import { audienceLabel } from "@/lib/agents/audience-label";
import { AgentAvatar, Pill, RUN_STATUS, RunStatusIcon, SourceLogos, StatusPill, timeAgo, timeUntil } from "./ui";

function Meta({ icon: Icon, children }: { icon: typeof Hash; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.ink2, minWidth: 0 }}>
      <Icon size={13} style={{ color: COLORS.ink4, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </span>
  );
}

/** Haut de carte commun : avatar, badges, nom, description, planning, destination. */
function CardTop({ agent, team }: { agent: AgentSummary; team: boolean }) {
  const designing = agent.design_status === "designing";
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <AgentAvatar emoji={agent.emoji} color={agent.color} size={44} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!team && agent.shared && (
            <span
              title={
                agent.subscribers_count > 0
                  ? `Shared with the team · ${agent.subscribers_count} teammate${agent.subscribers_count > 1 ? "s" : ""} subscribed`
                  : "Shared with the team"
              }
            >
              <Pill fg={COLORS.ok} bg={COLORS.okBg}>
                <Users size={11} /> Shared{agent.subscribers_count > 0 ? ` · ${agent.subscribers_count}` : ""}
              </Pill>
            </span>
          )}
          {agent.missing_tools_count > 0 && !designing && (
            <Pill fg={COLORS.warn} bg={COLORS.warnBg}>
              <Puzzle size={11} /> {agent.missing_tools_count === 1 ? "Missing tool" : `${agent.missing_tools_count} missing tools`}
            </Pill>
          )}
          <StatusPill status={agent.status} designStatus={agent.design_status} />
        </span>
      </div>

      <div style={{ marginTop: 12, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {designing && agent.name === "New agent" ? "Designing your agent…" : agent.name}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: COLORS.ink3,
            lineHeight: 1.5,
            marginTop: 3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 37,
          }}
        >
          {agent.tagline || (designing ? "CoachelloAI is writing the instructions and the message template." : "No description yet.")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 12, minWidth: 0 }}>
        <Meta icon={CalendarClock}>{shortSchedule(agent.schedule)}</Meta>
        {team ? (
          // Lancé ou reçu par un collègue, l'agent arrive toujours dans SON DM.
          <Meta icon={MessageSquare}>Your DMs</Meta>
        ) : (
          <Meta icon={agent.destination.type === "channel" ? Hash : agent.destination.type === "audience" ? Users : MessageSquare}>
            {agent.destination.type === "channel"
              ? agent.destination.channelName
              : agent.destination.type === "audience"
                ? audienceLabel(agent.destination)
                : "Direct message"}
          </Meta>
        )}
      </div>
    </>
  );
}

const footerStyle: React.CSSProperties = {
  marginTop: "auto",
  paddingTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderTop: `1px solid ${COLORS.line}`,
  marginInline: -18,
  paddingInline: 18,
  minHeight: 44,
};

/**
 * Carte d'un agent. Mes agents : toute la carte ouvre l'éditeur. Agents de
 * l'équipe : la carte ouvre l'agent, et une barre d'actions (hors du lien,
 * pas de bouton dans un <a>) permet "Try it now" et "Subscribe" directement.
 */
export function AgentCard({
  agent,
  showOwner = false,
  onSubscribe,
}: {
  agent: AgentSummary;
  showOwner?: boolean;
  onSubscribe?: (agent: AgentSummary, active: boolean) => Promise<void>;
}) {
  const draft = agent.status === "draft";
  const designing = agent.design_status === "designing";
  const [subscribing, setSubscribing] = React.useState(false);

  const toggle = async (active: boolean) => {
    if (!onSubscribe) return;
    if (!active && !window.confirm(`Stop receiving "${agent.name}" in your DMs?`)) return;
    setSubscribing(true);
    try {
      await onSubscribe(agent, active);
    } finally {
      setSubscribing(false);
    }
  };

  if (showOwner) {
    return (
      <div className="ag-card ag-card-box" style={{ display: "flex", flexDirection: "column", minHeight: 196 }}>
        <Link href={`/agents/${agent.id}`} className="ag-card-main" style={{ padding: "18px 18px 0" }}>
          <CardTop agent={agent} team />
        </Link>
        <div style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ ...footerStyle, marginTop: 14, minHeight: 36, paddingTop: 10 }}>
            <span style={{ fontSize: 12, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              by {agent.owner_name ?? "a teammate"}
            </span>
            <SourceLogos sources={agent.sources} size={20} max={4} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <Link href={`/agents/${agent.id}?run=me`} className="ag-btn ag-btn-sm" title="Runs once, now, with your own data. Nothing is sent.">
              <Play size={13} /> Try it now
            </Link>
            {agent.subscribed ? (
              <button type="button" className="ag-btn ag-btn-sm ag-btn-subscribed" title="Click to unsubscribe" disabled={subscribing || !onSubscribe} onClick={() => toggle(false)}>
                {subscribing ? <Loader2 size={13} className="ag-spin" /> : <BellRing size={13} />} Subscribed
              </button>
            ) : (
              <button
                type="button"
                className="ag-btn ag-btn-sm ag-btn-primary"
                title={`Get it in your DMs, ${describeSchedule(agent.schedule).replace(/^Every/, "every")}`}
                disabled={subscribing || !onSubscribe}
                onClick={() => toggle(true)}
              >
                {subscribing ? <Loader2 size={13} className="ag-spin" /> : <Bell size={13} />} Subscribe
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link href={`/agents/${agent.id}`} className={`ag-card ag-card-link ${draft ? "ag-card-draft" : ""}`} style={{ padding: 18, minHeight: 196 }}>
      <CardTop agent={agent} team={false} />
      <div style={footerStyle}>
        {draft ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: COLORS.brand }}>
            {designing ? "Preparing your draft" : "Review and activate"} <ArrowRight size={13} />
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2, minWidth: 0 }}>
            {agent.last_run_status ? (
              <>
                <RunStatusIcon status={agent.last_run_status} size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {RUN_STATUS[agent.last_run_status].label} {timeAgo(agent.last_run_at)}
                </span>
              </>
            ) : (
              <span style={{ color: COLORS.ink3 }}>No run yet</span>
            )}
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {agent.status === "active" && agent.next_run_at && (
            <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>Next {timeUntil(agent.next_run_at)}</span>
          )}
          <SourceLogos sources={agent.sources} size={22} max={4} />
        </span>
      </div>
    </Link>
  );
}
