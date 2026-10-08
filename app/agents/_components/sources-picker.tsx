"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ToolLogo } from "@/app/_components/tool-logo";
import { AGENT_SOURCES, type AgentSourceKey } from "@/lib/agents/sources";

/**
 * Grille des sources cochables. Sous chaque source retenue par le designer IA,
 * sa raison ("why"), sinon la description générique. `unavailable` : sources
 * interdites dans ce contexte (ex. Gmail pour un envoi à un groupe), avec la
 * raison affichée à la place de la description.
 */
export function SourcesPicker({
  value,
  onChange,
  reasons,
  unavailable,
  disabled = false,
}: {
  value: AgentSourceKey[];
  onChange: (v: AgentSourceKey[]) => void;
  reasons?: Partial<Record<AgentSourceKey, string>>;
  unavailable?: Partial<Record<AgentSourceKey, string>>;
  disabled?: boolean;
}) {
  const toggle = (key: AgentSourceKey) => {
    const next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    onChange(AGENT_SOURCES.map((s) => s.key).filter((k) => next.includes(k)));
  };

  return (
    <div className="ag-sources">
      {AGENT_SOURCES.map((s) => {
        const blocked = unavailable?.[s.key];
        const on = value.includes(s.key) && !blocked;
        const reason = on ? reasons?.[s.key] : undefined;
        return (
          <button
            key={s.key}
            type="button"
            className="ag-source"
            aria-pressed={on}
            disabled={disabled || !!blocked}
            onClick={() => toggle(s.key)}
            title={blocked ?? s.note}
            style={blocked ? { opacity: 0.55 } : undefined}
          >
            <span className="ag-source-logo">
              <ToolLogo logo={s.logo} size={16} />
            </span>
            <span style={{ minWidth: 0, paddingRight: 18 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{s.label}</span>
              {blocked ? (
                <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.45, marginTop: 1 }}>{blocked}</span>
              ) : reason ? (
                <span style={{ display: "flex", gap: 4, alignItems: "flex-start", fontSize: 11.5, color: COLORS.brandDark, lineHeight: 1.45, marginTop: 1 }}>
                  <Sparkles size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                  {reason}
                </span>
              ) : (
                <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.45, marginTop: 1 }}>{s.description}</span>
              )}
              {on && s.note && <span style={{ display: "block", fontSize: 11, color: COLORS.warn, marginTop: 3 }}>{s.note}</span>}
            </span>
            {on && (
              <span className="ag-source-check">
                <Check size={11} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
