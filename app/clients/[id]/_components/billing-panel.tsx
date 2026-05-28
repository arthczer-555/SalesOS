"use client";

import { useState } from "react";
import { Receipt, TrendingUp, TrendingDown, RefreshCw, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { Billing } from "@/lib/clients/types";

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function BillingPanel({
  billing,
  refreshedAt,
  clientId,
  onUpdated,
}: {
  billing: Billing | null;
  refreshedAt: string | null;
  clientId?: string;
  onUpdated?: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!clientId) return;
    setReloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/refresh-billing`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setReloading(false);
    }
  }

  const header = (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Receipt size={14} style={{ color: billing?.matched ? COLORS.ink1 : COLORS.ink3 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: billing?.matched ? COLORS.ink0 : COLORS.ink2 }}>
          Billing
        </h3>
        {billing?.is_rfp && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 7px",
              borderRadius: 999,
              background: COLORS.brandTint,
              color: COLORS.brand,
              textTransform: "uppercase",
            }}
          >
            RFP
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {refreshedAt && <span style={{ fontSize: 11, color: COLORS.ink3 }}>updated {fmtDate(refreshedAt)}</span>}
          {clientId && (
            <button
              type="button"
              onClick={reload}
              disabled={reloading}
              title="Reload billing from the revenue file"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
                background: reloading ? COLORS.bgSoft : COLORS.bgCard,
                color: reloading ? COLORS.ink3 : COLORS.ink2,
                cursor: reloading ? "not-allowed" : "pointer",
              }}
            >
              {reloading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {reloading ? "Reloading…" : "Reload"}
            </button>
          )}
        </div>
      </div>
      {error && <div style={{ fontSize: 11, color: COLORS.err, marginTop: 6 }}>{error}</div>}
    </div>
  );

  if (!billing?.matched) {
    return (
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.lineStrong}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        {header}
        <div style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.5, marginTop: 6 }}>
          No billing line found for this client in the revenue file.
        </div>
      </div>
    );
  }

  const years = Object.keys(billing.revenue_by_year ?? {}).sort();
  const yoy = billing.yoy_growth;
  const YoyIcon = yoy != null && yoy < 0 ? TrendingDown : TrendingUp;
  const yoyColor = yoy == null ? COLORS.ink3 : yoy < 0 ? COLORS.err : COLORS.ok;

  return (
    <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 16 }}>
      {header}

      <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.ink3 }}>Total billed (lifetime)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.ink0 }}>{fmtEur(billing.total_contract_value)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.ink3 }}>This year</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.ink0, display: "flex", alignItems: "center", gap: 6 }}>
            {fmtEur(billing.current_year_revenue)}
            {yoy != null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: yoyColor, display: "inline-flex", alignItems: "center", gap: 2 }}>
                <YoyIcon size={13} />
                {(yoy * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {years.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 14 }}>Billing timeline</div>
          <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 4 }}>
            {years.map((y, i) => {
              const amount = billing.revenue_by_year?.[y] ?? null;
              const prev = i > 0 ? (billing.revenue_by_year?.[years[i - 1]] ?? null) : null;
              const delta = amount != null && prev != null && prev !== 0 ? (amount - prev) / prev : null;
              const isLast = i === years.length - 1;
              const DeltaIcon = delta != null && delta < 0 ? TrendingDown : TrendingUp;
              const deltaColor = delta == null ? COLORS.ink3 : delta < 0 ? COLORS.err : COLORS.ok;
              return (
                <div
                  key={y}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 0 auto", minWidth: 92 }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, marginBottom: 8 }}>{fmtEur(amount)}</div>
                  <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <div style={{ flex: 1, height: 2, background: i === 0 ? "transparent" : COLORS.line }} />
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        flexShrink: 0,
                        background: isLast ? COLORS.brand : COLORS.bgCard,
                        border: `2px solid ${isLast ? COLORS.brand : COLORS.lineStrong}`,
                      }}
                    />
                    <div style={{ flex: 1, height: 2, background: isLast ? "transparent" : COLORS.line }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, marginTop: 8 }}>{y}</div>
                  {delta != null && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        fontSize: 11,
                        fontWeight: 600,
                        color: deltaColor,
                        marginTop: 2,
                      }}
                    >
                      <DeltaIcon size={11} />
                      {(delta * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
