"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

// Entier borné avec boutons - / +. Saisie directe validée au blur.
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  size = "md",
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: React.ReactNode;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const h = size === "sm" ? 28 : 32;
  const btn: React.CSSProperties = {
    width: h,
    height: h,
    display: "inline-grid",
    placeItems: "center",
    border: 0,
    background: "transparent",
    color: COLORS.ink2,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${COLORS.lineStrong}`,
        borderRadius: 10,
        background: "#fff",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <button type="button" style={btn} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} aria-label="Decrease">
        <Minus size={13} />
      </button>
      <input
        value={draft}
        disabled={disabled}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => {
          const n = clamp(Number(draft) || min);
          setDraft(String(n));
          if (n !== value) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp") onChange(clamp(value + step));
          if (e.key === "ArrowDown") onChange(clamp(value - step));
        }}
        style={{
          width: 34,
          textAlign: "center",
          border: 0,
          outline: "none",
          font: "inherit",
          fontSize: size === "sm" ? 12 : 13,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: COLORS.ink0,
          background: "transparent",
        }}
      />
      {suffix ? <span style={{ fontSize: 12, color: COLORS.ink3, paddingRight: 2 }}>{suffix}</span> : null}
      <button type="button" style={btn} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} aria-label="Increase">
        <Plus size={13} />
      </button>
    </div>
  );
}
