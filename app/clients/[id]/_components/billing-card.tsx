"use client";

import { useState } from "react";
import { Loader2, Receipt, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { Billing, HubspotDealFields } from "@/lib/clients/types";
import { Card, CardHeader, Eyebrow, Tag, daysUntil, fmtDay, fmtEur, parseLooseDate } from "./ui";

// Carte "Billing" de Key insights, à côté de la santé : CA de l'année (sheet
// revenue, source de vérité), YoY, lifetime, barres par année, et le contrat
// (dates HubSpot lues en live). Société absente du sheet : état explicite.

export function BillingCard({
  billing,
  refreshedAt,
  dealFields,
  clientId,
  onUpdated,
}: {
  billing: Billing | null;
  refreshedAt: string | null;
  dealFields: HubspotDealFields | null | undefined;
  clientId: string;
  onUpdated: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setReloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/refresh-billing`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setReloading(false);
    }
  }

  const reloadBtn = (
    <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={reload} disabled={reloading} title="Reload from the revenue file">
      {reloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {reloading ? "Reloading…" : "Reload"}
    </button>
  );

  const contractStart = parseLooseDate(dealFields?.contract_start_date);
  const contractEnd = parseLooseDate(dealFields?.contract_end_date);
  const toEnd = daysUntil(contractEnd);
  const contractRows = (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "8px 14px",
        margin: 0,
        paddingTop: 14,
        borderTop: `1px dashed ${COLORS.lineStrong}`,
        fontSize: 12.5,
      }}
    >
      <dt style={{ color: COLORS.ink3 }}>Contract</dt>
      <dd style={{ margin: 0, textAlign: "right", fontWeight: 500 }}>
        {dealFields == null
          ? <span style={{ color: COLORS.warn }}>HubSpot unreachable</span>
          : contractStart || contractEnd
            ? `${fmtDay(contractStart, true)} → ${fmtDay(contractEnd, true)}`
            : <span style={{ color: COLORS.warn }}>Dates missing in HubSpot</span>}
      </dd>
      {toEnd !== null && (
        <>
          <dt style={{ color: COLORS.ink3 }}>{toEnd >= 0 ? "Renewal in" : "Contract ended"}</dt>
          <dd style={{ margin: 0, textAlign: "right" }}>
            <Tag tone={toEnd < 0 ? "err" : toEnd <= 120 ? "warn" : "neutral"}>
              {toEnd >= 0 ? `${toEnd} days` : `${-toEnd} days ago`}
            </Tag>
          </dd>
        </>
      )}
      {dealFields?.billing && (
        <>
          <dt style={{ color: COLORS.ink3 }}>Billing</dt>
          <dd style={{ margin: 0, textAlign: "right", fontWeight: 500 }}>{dealFields.billing}</dd>
        </>
      )}
    </dl>
  );

  if (!billing?.matched) {
    return (
      <Card style={{ display: "flex", flexDirection: "column" }}>
        <CardHeader icon={Receipt} title="Billing" right={reloadBtn} />
        <div style={{ fontSize: 13, color: COLORS.warn, fontWeight: 600 }}>No match in the revenue sheet</div>
        <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 4, lineHeight: 1.5 }}>
          The company name was not found in the revenue file, so billed revenue is unknown (not zero).
        </div>
        {error && <div style={{ fontSize: 12, color: COLORS.err, marginTop: 6 }}>{error}</div>}
        <div style={{ marginTop: "auto", paddingTop: 16 }}>{contractRows}</div>
      </Card>
    );
  }

  const years = Object.keys(billing.revenue_by_year ?? {}).sort();
  const lastYears = years.slice(-5);
  const max = Math.max(1, ...lastYears.map((y) => billing.revenue_by_year?.[y] ?? 0));
  const currentYear = String(new Date().getFullYear());
  const yoy = billing.yoy_growth;
  const yoyUp = yoy != null && yoy >= 0;

  return (
    <Card style={{ display: "flex", flexDirection: "column" }}>
      <CardHeader icon={Receipt} title="Billing" meta={refreshedAt ? `Revenue sheet · ${fmtDay(refreshedAt)}` : "Revenue sheet"} right={reloadBtn} />
      <Eyebrow>{currentYear} revenue</Eyebrow>
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
          {fmtEur(billing.current_year_revenue)}
        </span>
        {yoy != null && (
          <Tag tone={yoyUp ? "ok" : "err"}>
            {yoyUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {yoyUp ? "+" : ""}
            {(yoy * 100).toFixed(0)}% vs {Number(currentYear) - 1}
          </Tag>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: COLORS.ink2 }}>
        Lifetime <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtEur(billing.total_contract_value)}</b>
        {billing.is_rfp ? " · RFP" : ""}
      </div>

      {lastYears.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${lastYears.length}, 1fr)`,
            gap: 10,
            alignItems: "end",
            height: 60,
            marginTop: 12,
          }}
        >
          {lastYears.map((y) => {
            const amount = billing.revenue_by_year?.[y] ?? 0;
            const isCur = y === currentYear;
            return (
              <div
                key={y}
                title={`${y}: ${fmtEur(amount)}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, height: "100%" }}
              >
                <i
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: 34,
                    height: Math.max(4, Math.round((amount / max) * 42)),
                    borderRadius: "6px 6px 3px 3px",
                    background: isCur ? COLORS.brand : COLORS.lineStrong,
                  }}
                />
                <span style={{ fontSize: 11, color: isCur ? COLORS.ink0 : COLORS.ink3, fontWeight: isCur ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                  {y}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: COLORS.err, marginTop: 6 }}>{error}</div>}
      <div style={{ marginTop: "auto", paddingTop: 16 }}>{contractRows}</div>
    </Card>
  );
}
