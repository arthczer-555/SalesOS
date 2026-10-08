import * as React from "react";
import { Loader2 } from "lucide-react";

type IconType = React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "dark" | "options";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ch-btn-primary",
  secondary: "",
  ghost: "ch-btn-ghost",
  danger: "ch-btn-danger",
  subtle: "ch-btn-subtle",
  dark: "ch-btn-dark",
  options: "ch-btn-options",
};

// Bouton du design system (classes .ch-btn de globals.css). `loading` remplace
// l'icône par un spinner et désactive le bouton.
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    loading?: boolean;
    icon?: IconType;
    iconRight?: IconType;
    fullWidth?: boolean;
  }
>(function Button(
  { variant = "secondary", size = "md", loading = false, icon: Icon, iconRight: IconRight, fullWidth, className = "", children, disabled, style, type = "button", ...rest },
  ref,
) {
  const iconSize = size === "sm" ? 13 : 14;
  const iconOnly = !children && (Icon || loading);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={["ch-btn", size === "sm" ? "ch-btn-sm" : "", VARIANT_CLASS[variant], iconOnly ? "ch-btn-icon-only" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{ justifyContent: "center", ...(fullWidth ? { width: "100%" } : null), ...style }}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="ds-spin" /> : Icon ? <Icon size={iconSize} /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} /> : null}
    </button>
  );
});
