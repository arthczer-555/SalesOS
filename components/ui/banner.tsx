import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const TONES = {
  info: { bg: COLORS.infoBg, fg: COLORS.info, border: "#ddd3fb", icon: Info },
  warn: { bg: "#fffaeb", fg: COLORS.warn, border: "#f6dfa4", icon: AlertTriangle },
  err: { bg: "#fff5f5", fg: COLORS.err, border: "#fbcaca", icon: XCircle },
  ok: { bg: COLORS.okBg, fg: COLORS.ok, border: "#c4ecd9", icon: CheckCircle2 },
  neutral: { bg: COLORS.bgSoft, fg: COLORS.ink1, border: COLORS.line, icon: Info },
} as const;

// Bandeau d'information / alerte en ligne, avec action optionnelle à droite.
export function Banner({
  tone = "info",
  title,
  children,
  action,
  icon,
  style,
}: {
  tone?: keyof typeof TONES;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: IconType;
  style?: React.CSSProperties;
}) {
  const t = TONES[tone];
  const Icon = icon ?? t.icon;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 12,
        background: t.bg,
        border: `1px solid ${t.border}`,
        ...style,
      }}
    >
      <Icon size={15} style={{ color: t.fg, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.ink1 }}>
        {title ? <div style={{ fontWeight: 700, color: tone === "neutral" ? COLORS.ink0 : t.fg }}>{title}</div> : null}
        {children}
      </div>
      {action ? <div style={{ flexShrink: 0, alignSelf: "center" }}>{action}</div> : null}
    </div>
  );
}
