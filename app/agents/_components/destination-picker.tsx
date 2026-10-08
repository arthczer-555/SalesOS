"use client";

import * as React from "react";
import { AlertTriangle, Check, Hash, Lock, MessageSquare, Search, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useSlackChannels } from "@/lib/hooks/use-agents";
import type { AudienceDestination } from "@/lib/agents/audience-label";
import type { AgentDestination } from "@/lib/agents/types";
import { AudiencePicker } from "./audience-picker";
import { Callout } from "./ui";

function OptionCard({
  selected,
  icon: Icon,
  title,
  text,
  onClick,
  disabled,
}: {
  selected: boolean;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ag-source"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      style={{ alignItems: "center", flex: 1, minWidth: 170 }}
    >
      <span className="ag-source-logo" style={{ color: selected ? COLORS.brand : COLORS.ink2 }}>
        <Icon size={15} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: COLORS.ink3 }}>{text}</span>
      </span>
      {selected && (
        <span className="ag-source-check">
          <Check size={11} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

const EMPTY_AUDIENCE: AudienceDestination = { type: "audience", groups: [], include: [], exclude: [], personalize: true };

/**
 * Destination Slack : DM de l'owner, canal (avec recherche) ou un groupe
 * ("Send to a group") recalculé à chaque exécution.
 */
export function DestinationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentDestination;
  onChange: (d: AgentDestination) => void;
  disabled?: boolean;
}) {
  const isChannel = value.type === "channel";
  const isAudience = value.type === "audience";
  // Repasser par DM ou canal puis revenir au groupe retrouve l'audience composée.
  const lastAudience = React.useRef<AudienceDestination>(value.type === "audience" ? value : EMPTY_AUDIENCE);
  React.useEffect(() => {
    if (value.type === "audience") lastAudience.current = value;
  }, [value]);
  const [picking, setPicking] = React.useState(false);
  const { channels, error, isLoading } = useSlackChannels(isChannel || picking);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = isChannel ? channels.find((c) => c.id === value.channelId) : undefined;
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const filtered = channels.filter((c) => !q || c.name.includes(q)).slice(0, 60);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <OptionCard
          selected={value.type === "dm" && !picking}
          icon={MessageSquare}
          title="Direct message"
          text="Sent to you by CoachelloAI"
          disabled={disabled}
          onClick={() => {
            setPicking(false);
            onChange({ type: "dm" });
          }}
        />
        <OptionCard
          selected={isChannel || picking}
          icon={Hash}
          title="Slack channel"
          text="Shared with everyone in it"
          disabled={disabled}
          onClick={() => {
            setPicking(true);
            setOpen(true);
          }}
        />
        <OptionCard
          selected={isAudience && !picking}
          icon={Users}
          title="Send to a group"
          text="In each person's DMs"
          disabled={disabled}
          onClick={() => {
            setPicking(false);
            setOpen(false);
            onChange(lastAudience.current);
          }}
        />
      </div>

      {isAudience && !picking && (
        <div className="ag-fade" style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16, marginTop: 2 }}>
          <AudiencePicker value={value} onChange={onChange} disabled={disabled} />
        </div>
      )}

      {(isChannel || picking) && (
        <div ref={wrapRef} style={{ position: "relative" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: COLORS.ink4 }} />
            <input
              className="ag-input"
              style={{ paddingLeft: 34 }}
              placeholder={isChannel ? `#${value.channelName}` : "Search a channel…"}
              value={open ? query : isChannel ? `#${value.channelName}` : query}
              disabled={disabled}
              onFocus={() => {
                setOpen(true);
                setQuery("");
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              aria-label="Slack channel"
            />
          </div>
          {open && !disabled && (
            <div className="ag-popover thin-scrollbar" style={{ left: 0, right: 0, top: "calc(100% + 6px)", maxHeight: 280, overflowY: "auto", padding: 6 }}>
              {isLoading && <div style={{ padding: 10, fontSize: 12.5, color: COLORS.ink3 }}>Loading channels…</div>}
              {error && <div style={{ padding: 10, fontSize: 12.5, color: COLORS.err }}>Could not load Slack channels: {error.message}</div>}
              {!isLoading && !error && filtered.length === 0 && (
                <div style={{ padding: 10, fontSize: 12.5, color: COLORS.ink3 }}>No channel matches &quot;{query}&quot;.</div>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="ag-menu-item"
                  onClick={() => {
                    onChange({ type: "channel", channelId: c.id, channelName: c.name });
                    setPicking(false);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {c.isPrivate ? <Lock size={13} style={{ color: COLORS.ink3 }} /> : <Hash size={13} style={{ color: COLORS.ink3 }} />}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                  {!c.isMember && <span style={{ fontSize: 11, color: COLORS.warn }}>invite needed</span>}
                  {isChannel && value.channelId === c.id && <Check size={14} style={{ color: COLORS.brand }} />}
                </button>
              ))}
            </div>
          )}
          {selected && !selected.isMember && (
            <Callout tone="warn" icon={AlertTriangle} style={{ marginTop: 10 }}>
              CoachelloAI is not in <b>#{selected.name}</b> yet. In Slack, type <code>/invite @CoachelloAI</code> in the channel before the first run.
            </Callout>
          )}
        </div>
      )}
    </div>
  );
}
