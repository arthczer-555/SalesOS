import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

// Interrupteur on/off. Avec `label`, rend une ligne cliquable (libellé + description).
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const btn = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="ds-switch"
      onClick={() => onChange(!checked)}
    />
  );
  if (!label) return btn;
  return (
    <div
      style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, cursor: disabled ? "not-allowed" : "pointer" }}
      onClick={(e) => {
        if (disabled || (e.target as HTMLElement).closest("button")) return;
        onChange(!checked);
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{label}</span>
        {description ? <span style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.45 }}>{description}</span> : null}
      </div>
      <div style={{ paddingTop: 1 }}>{btn}</div>
    </div>
  );
}
