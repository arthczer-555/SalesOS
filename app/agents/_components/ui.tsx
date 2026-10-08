"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, Lock, PauseCircle, Users, XCircle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ToolLogo } from "@/app/_components/tool-logo";
import { sourceDef, type AgentSourceKey } from "@/lib/agents/sources";
import { AGENT_COLORS, type AgentColor, type AgentDesignStatus, type AgentRunStatus, type AgentStatus } from "@/lib/agents/types";

// Primitives visuelles de /agents : avatar d'agent, statuts, logos de sources,
// sections du formulaire. Les classes ag-* vivent dans app/agents/agents.css.

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties; className?: string }>;

export function AgentAvatar({ emoji, color, size = 44 }: { emoji: string; color: AgentColor; size?: number }) {
  const c = AGENT_COLORS[color] ?? AGENT_COLORS.pink;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        display: "inline-grid",
        placeItems: "center",
        flexShrink: 0,
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: `linear-gradient(140deg, ${c.from}24 0%, ${c.to}66 100%)`,
        boxShadow: `inset 0 0 0 1px ${c.from}22, 0 1px 2px ${c.from}14`,
      }}
    >
      {emoji}
    </span>
  );
}

export function StatusPill({ status, designStatus }: { status: AgentStatus; designStatus?: AgentDesignStatus }) {
  if (designStatus === "designing") {
    return (
      <Pill fg={COLORS.info} bg={COLORS.infoBg}>
        <Loader2 size={11} className="ag-spin" /> Designing
      </Pill>
    );
  }
  if (status === "active") {
    return (
      <Pill fg={COLORS.ok} bg={COLORS.okBg}>
        <span className="ag-pulse-dot" /> Active
      </Pill>
    );
  }
  if (status === "paused") {
    return (
      <Pill fg={COLORS.warn} bg={COLORS.warnBg}>
        <PauseCircle size={11} /> Paused
      </Pill>
    );
  }
  return (
    <Pill fg={COLORS.ink2} bg="#f1f1f3">
      Draft
    </Pill>
  );
}

export function Pill({ children, fg, bg, style }: { children: React.ReactNode; fg: string; bg: string; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 999,
        color: fg,
        background: bg,
        whiteSpace: "nowrap",
        lineHeight: 1.4,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export const RUN_STATUS: Record<AgentRunStatus, { label: string; fg: string; bg: string; icon: IconType }> = {
  queued: { label: "Queued", fg: COLORS.info, bg: COLORS.infoBg, icon: Loader2 },
  running: { label: "Running", fg: COLORS.info, bg: COLORS.infoBg, icon: Loader2 },
  success: { label: "Sent", fg: COLORS.ok, bg: COLORS.okBg, icon: CheckCircle2 },
  skipped: { label: "Nothing to report", fg: COLORS.ink2, bg: "#f1f1f3", icon: CircleSlash },
  error: { label: "Failed", fg: COLORS.err, bg: COLORS.errBg, icon: XCircle },
};

export function RunStatusIcon({ status, size = 16 }: { status: AgentRunStatus; size?: number }) {
  const s = RUN_STATUS[status];
  const Icon = s.icon;
  const spinning = status === "queued" || status === "running";
  return <Icon size={size} style={{ color: s.fg, flexShrink: 0 }} className={spinning ? "ag-spin" : undefined} />;
}

/** Logos des sources en pastilles qui se chevauchent. */
export function SourceLogos({ sources, size = 22, max = 6 }: { sources: AgentSourceKey[]; size?: number; max?: number }) {
  if (sources.length === 0) return <span style={{ fontSize: 12, color: COLORS.ink4 }}>No sources</span>;
  const shown = sources.slice(0, max);
  const rest = sources.length - shown.length;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }} title={sources.map((s) => sourceDef(s).label).join(", ")}>
      {shown.map((s, i) => (
        <span
          key={s}
          style={{
            width: size,
            height: size,
            borderRadius: 999,
            background: "#fff",
            boxShadow: `0 0 0 1.5px #fff, 0 0 0 2.5px ${COLORS.line}`,
            display: "inline-grid",
            placeItems: "center",
            marginLeft: i === 0 ? 0 : -5,
            position: "relative",
            zIndex: shown.length - i,
          }}
        >
          <ToolLogo logo={sourceDef(s).logo} size={Math.round(size * 0.6)} />
        </span>
      ))}
      {rest > 0 && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, color: COLORS.ink3 }}>+{rest}</span>}
    </span>
  );
}

/** Carte de section du formulaire : numéro, titre, description, contenu. */
export function Section({
  num,
  title,
  description,
  right,
  children,
  id,
}: {
  num?: number;
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="ag-card" style={{ padding: "18px 20px 20px" }}>
      <div className="ag-section-head">
        {num != null && <span className="ag-section-num">{num}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.005em" }}>{title}</h3>
          {description && <p style={{ margin: "3px 0 0", fontSize: 12.5, color: COLORS.ink3, lineHeight: 1.5 }}>{description}</p>}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ag-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Interrupteur "Share with the team" (builder et éditeur). Éteint = agent
 * personnel, invisible de l'équipe. Allumé = visible dans l'onglet Team, les
 * collègues peuvent l'essayer et s'y abonner, avec leurs propres données.
 */
export function SharingToggle({
  value,
  onChange,
  disabled,
  subscribers = 0,
  wasShared = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  subscribers?: number;
  wasShared?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            background: value ? COLORS.okBg : "#f1f1f3",
            color: value ? COLORS.ok : COLORS.ink3,
            transition: "background 0.18s, color 0.18s",
          }}
        >
          {value ? <Users size={16} /> : <Lock size={15} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Share with the team</div>
          <div className="ag-hint">
            {value
              ? "Teammates see how it works, can try it and subscribe. It runs with their own data, in their DMs. Your messages stay private."
              : "Personal: only you see this agent. Turn it on to let teammates try it and subscribe."}
          </div>
        </div>
        <Switch checked={value} onChange={onChange} disabled={disabled} label="Share with the team" />
      </div>
      {wasShared && !value && subscribers > 0 && (
        <Callout tone="warn" icon={AlertTriangle}>
          {subscribers} teammate{subscribers > 1 ? "s are" : " is"} subscribed: they&apos;ll stop receiving it once you save.
        </Callout>
      )}
    </div>
  );
}

export function Callout({
  tone = "info",
  icon: Icon,
  children,
  style,
}: {
  tone?: "info" | "warn" | "err" | "brand";
  icon?: IconType;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = {
    info: { fg: COLORS.info, bg: "#f6f3ff", border: "#e4dcfd" },
    warn: { fg: COLORS.warn, bg: "#fffaeb", border: "#f6dfa4" },
    err: { fg: COLORS.err, bg: "#fff5f5", border: "#fbcaca" },
    brand: { fg: COLORS.brandDark, bg: COLORS.brandTintSoft, border: "#f7b7cc" },
  }[tone];
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: 10,
        background: t.bg,
        border: `1px solid ${t.border}`,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: COLORS.ink1,
        ...style,
      }}
    >
      {Icon && <Icon size={15} style={{ color: t.fg, flexShrink: 0, marginTop: 1 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  );
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return "-";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "any minute";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** "Mon 6 Oct, 09:00" dans le fuseau du navigateur. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "-";
  const s = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "-";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}
