"use client";

import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { RefreshReport } from "@/lib/clients/types";

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function RefreshReportPanel({ report }: { report: RefreshReport | null }) {
  if (!report) return null;

  const before = report.health_before;
  const after = report.health_after;
  const delta = before != null && after != null ? after - before : null;
  const TrendIcon = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendColor = delta == null || delta === 0 ? COLORS.ink3 : delta > 0 ? COLORS.ok : COLORS.err;

  return (
    <div
      style={{
        background: report.error ? COLORS.errBg : COLORS.bgSoft,
        border: `1px solid ${report.error ? COLORS.err : COLORS.line}`,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        color: COLORS.ink2,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <RefreshCw size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: COLORS.ink1 }}>Refreshed on {fmtDateTime(report.refreshed_at)}</span>

      {report.error ? (
        <span style={{ color: COLORS.err }}>· failed: {report.error}</span>
      ) : (
        <>
          <span style={{ color: COLORS.ink3 }}>·</span>
          <span>
            {report.new_activity_count} new {report.new_activity_count > 1 ? "activities" : "activity"}
          </span>

          {before != null && after != null && (
            <>
              <span style={{ color: COLORS.ink3 }}>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: trendColor }}>
                <TrendIcon size={13} />
                health {before} → {after}
              </span>
            </>
          )}

          <span style={{ color: COLORS.ink3 }}>·</span>
          {report.changed_fields.length === 0 ? (
            <span>no field changed</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {report.changed_fields.length} {report.changed_fields.length > 1 ? "fields" : "field"} updated:
              {report.changed_fields.slice(0, 6).map((f) => (
                <span
                  key={`${f.section}.${f.key}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: COLORS.brandTint,
                    color: COLORS.brand,
                  }}
                >
                  {f.label}
                </span>
              ))}
              {report.changed_fields.length > 6 && <span>+{report.changed_fields.length - 6}</span>}
            </span>
          )}
        </>
      )}
    </div>
  );
}
