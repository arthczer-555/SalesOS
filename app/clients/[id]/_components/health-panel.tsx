"use client";

import { Activity, TrendingUp, TrendingDown, Minus, AlertCircle, Eye, CheckCircle2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { Health, Insights, HealthLabel } from "@/lib/clients/types";
import { EditableText } from "./editable";
import { patchContent } from "./content-client";

const LABEL_STYLE: Record<HealthLabel, { fg: string; bg: string; label: string }> = {
  green: { fg: COLORS.ok, bg: COLORS.okBg, label: "Healthy" },
  yellow: { fg: COLORS.warn, bg: COLORS.warnBg, label: "Needs attention" },
  red: { fg: COLORS.err, bg: COLORS.errBg, label: "At risk" },
};

const PRIORITY_STYLE: Record<"high" | "medium" | "low", { fg: string; bg: string; label: string }> = {
  high: { fg: COLORS.err, bg: COLORS.errBg, label: "High priority" },
  medium: { fg: COLORS.warn, bg: COLORS.warnBg, label: "Medium priority" },
  low: { fg: COLORS.ink2, bg: COLORS.bgSoft, label: "Low priority" },
};

function TrendIcon({ trend }: { trend: Health["trend"] }) {
  if (trend === "up") return <TrendingUp size={14} style={{ color: COLORS.ok }} />;
  if (trend === "down") return <TrendingDown size={14} style={{ color: COLORS.err }} />;
  return <Minus size={14} style={{ color: COLORS.ink3 }} />;
}

export function HealthPanel({
  health,
  insights,
  clientId,
  onUpdated,
}: {
  health: Health | null;
  insights: Insights | null;
  clientId?: string;
  onUpdated?: () => void;
}) {
  if (!health) {
    return (
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.lineStrong}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Activity size={14} style={{ color: COLORS.ink3 }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink2 }}>Health &amp; prioritized actions</h3>
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
          Will be computed at the next enrichment from HubSpot engagements and Claap meetings.
        </div>
      </div>
    );
  }

  const labelStyle = LABEL_STYLE[health.label];

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Activity size={14} style={{ color: COLORS.ink1 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
          Health &amp; prioritized actions
        </h3>
        {health.computed_at && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            computed on {new Date(health.computed_at).toLocaleDateString("en-GB")}
          </span>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Score header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: labelStyle.fg,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {health.score}
            <span style={{ fontSize: 16, color: COLORS.ink3, fontWeight: 500 }}>/100</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: 999,
                background: labelStyle.bg,
                color: labelStyle.fg,
                fontSize: 12,
                fontWeight: 600,
                width: "fit-content",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: labelStyle.fg }} />
              {labelStyle.label}
            </span>
            {health.trend && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  color: COLORS.ink3,
                }}
              >
                <TrendIcon trend={health.trend} />
                Trend: {health.trend === "up" ? "up" : health.trend === "down" ? "down" : "stable"}
              </span>
            )}
          </div>
        </div>

        {/* Phrase d'explication (IA, ancrée sur les derniers échanges) — éditable */}
        {clientId ? (
          <div style={{ paddingLeft: 12, borderLeft: `3px solid ${labelStyle.fg}` }}>
            <EditableText
              value={health.summary ?? null}
              multiline
              placeholder="Sentence explaining the score (anchored on the latest exchanges)"
              onSave={async (v) => {
                await patchContent(clientId, "health", { ...health, summary: v });
                onUpdated?.();
              }}
            />
          </div>
        ) : (
          health.summary && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.55,
                color: COLORS.ink1,
                paddingLeft: 12,
                borderLeft: `3px solid ${labelStyle.fg}`,
              }}
            >
              {health.summary}
            </p>
          )
        )}

        {/* Drivers */}
        {health.drivers && health.drivers.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              Key drivers
            </div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {health.drivers.map((d, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 13,
                    color: COLORS.ink1,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                >
                  <span style={{ color: COLORS.ink4 }}>•</span>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        {insights && insights.actions && insights.actions.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              Prioritized actions ({insights.actions.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {insights.actions.map((a, i) => {
                const p = a.priority ?? "medium";
                const ps = PRIORITY_STYLE[p];
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 10,
                      borderRadius: 8,
                      border: `1px solid ${COLORS.line}`,
                      background: COLORS.bgSoft,
                    }}
                  >
                    <AlertCircle size={14} style={{ color: ps.fg, marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{a.title}</span>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: ps.bg,
                            color: ps.fg,
                            fontWeight: 600,
                            letterSpacing: 0.3,
                          }}
                        >
                          {ps.label}
                        </span>
                      </div>
                      {a.rationale && (
                        <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 2, lineHeight: 1.5 }}>
                          {a.rationale}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Observations */}
        {insights && insights.observations && insights.observations.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              Observations
            </div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {insights.observations.map((o, i) => (
                <li
                  key={i}
                  style={{ fontSize: 12, color: COLORS.ink2, display: "flex", gap: 6, alignItems: "flex-start" }}
                >
                  <Eye size={12} style={{ marginTop: 3, color: COLORS.ink4, flexShrink: 0 }} />
                  {o}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(!insights || ((!insights.actions || insights.actions.length === 0) && (!insights.observations || insights.observations.length === 0))) && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: COLORS.ink3 }}>
            <CheckCircle2 size={12} />
            No priority action identified yet.
          </div>
        )}
      </div>
    </div>
  );
}
