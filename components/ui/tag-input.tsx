"use client";

import * as React from "react";
import { X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

// Saisie de liste de mots-clés : Entrée / virgule pour ajouter, Backspace pour
// retirer le dernier, collage multi-lignes accepté. Suggestions optionnelles.
export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  max,
  size = "md",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
  size?: "sm" | "md";
}) {
  const [draft, setDraft] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      if (lower.has(p.toLowerCase())) continue;
      if (max && next.length >= max) break;
      lower.add(p.toLowerCase());
      next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  const filtered = suggestions
    .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
    .filter((s) => !draft || s.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 8);

  return (
    <div style={{ position: "relative" }}>
      <div
        className={`ds-input ds-tag-input ${size === "sm" ? "ds-input-sm" : ""}`.trim()}
        onClick={() => inputRef.current?.focus()}
        style={focused ? { borderColor: COLORS.brand, boxShadow: "0 0 0 3px rgba(240, 21, 99, 0.12)" } : undefined}
      >
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="ds-tag-chip">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) add(draft);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n;]/.test(text)) {
              e.preventDefault();
              add(text);
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {focused && filtered.length > 0 ? (
        <div
          className="ds-pop"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(20,20,30,0.12)",
            padding: 4,
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="ch-menu-item"
              style={{ fontSize: 12, padding: "6px 8px" }}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
