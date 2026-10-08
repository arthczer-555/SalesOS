import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

// Champ texte du design system. Avec `icon` ou `right`, le champ est rendu dans
// un wrapper qui porte la bordure (.ds-input-wrap) pour garder le focus ring.
export const Input = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: "sm" | "md";
    icon?: IconType;
    right?: React.ReactNode;
    invalid?: boolean;
    wrapperStyle?: React.CSSProperties;
  }
>(function Input({ size = "md", icon: Icon, right, invalid, className = "", style, wrapperStyle, ...rest }, ref) {
  const cls = ["ds-input", size === "sm" ? "ds-input-sm" : "", invalid ? "ds-input-invalid" : ""].filter(Boolean).join(" ");
  if (!Icon && !right) {
    return <input ref={ref} className={`${cls} ${className}`.trim()} style={style} aria-invalid={invalid || undefined} {...rest} />;
  }
  return (
    <label className={`${cls} ds-input-wrap ${className}`.trim()} style={wrapperStyle}>
      {Icon ? <Icon size={size === "sm" ? 13 : 14} style={{ color: COLORS.ink3, flexShrink: 0 }} /> : null}
      <input ref={ref} style={style} aria-invalid={invalid || undefined} {...rest} />
      {right}
    </label>
  );
});
