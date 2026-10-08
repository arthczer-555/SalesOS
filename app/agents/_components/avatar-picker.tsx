"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { AGENT_COLORS, AGENT_COLOR_KEYS, AGENT_EMOJIS, type AgentColor } from "@/lib/agents/types";
import { AgentAvatar } from "./ui";

/** Avatar cliquable de l'éditeur : popover emoji + couleur. */
export function AvatarPicker({
  emoji,
  color,
  onChange,
  disabled,
  size = 56,
}: {
  emoji: string;
  color: AgentColor;
  onChange: (patch: { emoji?: string; color?: AgentColor }) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (disabled) return <AgentAvatar emoji={emoji} color={color} size={size} />;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" className="ag-avatar-btn" onClick={() => setOpen((o) => !o)} aria-label="Change icon and color" title="Change icon and color">
        <AgentAvatar emoji={emoji} color={color} size={size} />
      </button>
      {open && (
        <div className="ag-popover" style={{ top: size + 8, left: 0, width: 300 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4, marginBottom: 6 }}>Icon</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
            {AGENT_EMOJIS.map((e) => (
              <button key={e} type="button" className="ag-emoji" aria-pressed={e === emoji} onClick={() => onChange({ emoji: e })}>
                {e}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4, margin: "12px 0 8px" }}>Color</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {AGENT_COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                className="ag-color"
                aria-pressed={c === color}
                aria-label={c}
                title={c}
                style={{ background: `linear-gradient(140deg, ${AGENT_COLORS[c].from}, ${AGENT_COLORS[c].to})` }}
                onClick={() => onChange({ color: c })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
