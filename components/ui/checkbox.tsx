"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

// Case à cocher (supporte l'état indéterminé pour "tout sélectionner").
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  title,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean, e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  const box = (
    <input
      ref={ref}
      type="checkbox"
      className="ds-checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      onClick={onClick}
      onChange={(e) => onChange(e.target.checked, e)}
    />
  );
  if (!label) return box;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.ink1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {box}
      {label}
    </label>
  );
}
