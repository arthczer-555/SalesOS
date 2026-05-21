"use client";

import * as React from "react";
import { RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { BriefStatus } from "@/lib/watchlist/briefs";

export function BriefSection({
  title,
  icon,
  status,
  completedAt,
  error,
  onRefresh,
  disabled = false,
  staleBadge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  status: BriefStatus;
  completedAt: string | null;
  error: string | null;
  onRefresh?: () => void;
  disabled?: boolean;
  staleBadge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
        }}
      >
        <span style={{ display: "inline-flex", color: COLORS.ink2 }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>{title}</h2>

        <StatusPill status={status} />
        {staleBadge && (
          <span
            title={staleBadge}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: 999,
              background: COLORS.warnBg,
              color: COLORS.warn,
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            ⚠ {staleBadge}
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {completedAt && (
            <span style={{ fontSize: 10, color: COLORS.ink3 }}>
              {formatRelative(completedAt)}
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={disabled || status === "running"}
              title={status === "ok" ? "Régénérer" : "Générer"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 8,
                border: `1px solid ${COLORS.line}`,
                background: status === "ok" ? COLORS.bgCard : COLORS.brand,
                color: status === "ok" ? COLORS.ink1 : "white",
                cursor: disabled || status === "running" ? "not-allowed" : "pointer",
                opacity: disabled || status === "running" ? 0.5 : 1,
              }}
            >
              {status === "running" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              {status === "running" ? "En cours…" : status === "ok" ? "Régénérer" : "Générer"}
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: "14px 16px" }}>
        {status === "error" && error && (
          <div
            style={{
              padding: "8px 10px",
              background: COLORS.errBg,
              color: COLORS.err,
              fontSize: 11,
              borderRadius: 8,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <AlertCircle size={12} /> {error}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: BriefStatus }) {
  if (status === "idle") return null;
  if (status === "running") {
    return (
      <span style={pill(COLORS.info, COLORS.infoBg)}>
        <Loader2 size={9} className="animate-spin" /> En cours
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span style={pill(COLORS.ok, COLORS.okBg)}>
        <CheckCircle2 size={9} /> À jour
      </span>
    );
  }
  return (
    <span style={pill(COLORS.err, COLORS.errBg)}>
      <AlertCircle size={9} /> Erreur
    </span>
  );
}

function pill(fg: string, bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 10,
    fontWeight: 600,
  };
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `Il y a ${d}j`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}
