import { COLORS } from "@/lib/design/tokens";
import type { Health, HealthLabel } from "@/lib/clients/types";

const STYLE: Record<HealthLabel, { fg: string; bg: string; dot: string; label: string }> = {
  green: { fg: COLORS.ok, bg: COLORS.okBg, dot: COLORS.ok, label: "Healthy" },
  yellow: { fg: COLORS.warn, bg: COLORS.warnBg, dot: COLORS.warn, label: "Needs attention" },
  red: { fg: COLORS.err, bg: COLORS.errBg, dot: COLORS.err, label: "At risk" },
};

export function HealthBadge({ health, compact = false }: { health: Health | null; compact?: boolean }) {
  if (!health) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: compact ? "2px 8px" : "3px 10px",
          borderRadius: 999,
          background: COLORS.bgSoft,
          color: COLORS.ink3,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: COLORS.ink4,
          }}
        />
        Not calculated yet
      </span>
    );
  }
  const s = STYLE[health.label];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: compact ? "2px 8px" : "3px 10px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
      }}
      title={health.drivers?.join(" · ")}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {s.label}
      {!compact && typeof health.score === "number" && <span style={{ opacity: 0.7 }}>· {health.score}/100</span>}
    </span>
  );
}
