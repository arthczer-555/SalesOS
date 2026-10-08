import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string }>;

export type TagTone = "neutral" | "ok" | "warn" | "err" | "brand" | "info" | "solid" | "dark";

export const TAG_TONES: Record<TagTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: COLORS.bgSoft, fg: COLORS.ink1, border: COLORS.line },
  ok: { bg: COLORS.okBg, fg: COLORS.ok, border: "#c4ecd9" },
  warn: { bg: COLORS.warnBg, fg: COLORS.warn, border: "#f6dfa4" },
  err: { bg: COLORS.errBg, fg: COLORS.err, border: "#fbcaca" },
  brand: { bg: COLORS.brandTint, fg: COLORS.brandDark, border: "#f7b7cc" },
  info: { bg: COLORS.infoBg, fg: COLORS.info, border: "#ddd3fb" },
  solid: { bg: COLORS.brand, fg: "#fff", border: COLORS.brand },
  dark: { bg: COLORS.ink0, fg: "#fff", border: COLORS.ink0 },
};

// Badge / pilule à tonalité (statuts, catégories). `dot` ajoute une pastille.
export function Tag({
  tone = "neutral",
  children,
  title,
  icon: Icon,
  dot,
  size = "md",
  style,
}: {
  tone?: TagTone;
  children: React.ReactNode;
  title?: string;
  icon?: IconType;
  dot?: boolean;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}) {
  const t = TAG_TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: size === "sm" ? 10.5 : 11,
        fontWeight: 600,
        padding: size === "sm" ? "1px 7px" : "2px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        whiteSpace: "nowrap",
        lineHeight: 1.5,
        ...style,
      }}
    >
      {dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: t.fg, flexShrink: 0 }} /> : null}
      {Icon ? <Icon size={11} /> : null}
      {children}
    </span>
  );
}
