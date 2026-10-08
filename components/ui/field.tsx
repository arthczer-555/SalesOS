import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

// Libellé + aide + erreur autour d'un champ de formulaire.
export function Field({
  label,
  hint,
  error,
  required,
  right,
  htmlFor,
  children,
  style,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  right?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...style }}>
      {label || right ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {label ? (
            <label htmlFor={htmlFor} style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1 }}>
              {label}
              {required ? <span style={{ color: COLORS.brand, marginLeft: 3 }}>*</span> : null}
            </label>
          ) : (
            <span />
          )}
          {right}
        </div>
      ) : null}
      {children}
      {error ? (
        <span style={{ fontSize: 12, color: COLORS.err }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.45 }}>{hint}</span>
      ) : null}
    </div>
  );
}
