"use client";

import { useState } from "react";
import { Link2, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import { BillingLinkModal } from "@/app/clients/_components/billing-link-modal";
import type { Billing, ClientFieldValue, HubspotDealFields } from "@/lib/clients/types";
import { resolveContractEnd } from "@/lib/clients/lifecycle";
import { Card, CardHeader, ContractEndOrigin, Eyebrow, InvalidContractEnd, Tag, contractEndTone, daysUntil, fmtDay, fmtEur, parseLooseDate } from "./ui";

// Carte "Billing" de Key insights, à côté de la santé : CA de l'année (sheet
// revenue, source de vérité), YoY, lifetime, barres par année, et le contrat
// (dates HubSpot lues en live ; sans fin de contrat HubSpot valable, celle
// trouvée dans les échanges). Société absente du sheet : état explicite, avec
// le lien manuel vers la bonne ligne (BillingLinkModal), aussi proposé sous les
// montants pour corriger un match par nom faux.

export function BillingCard({
  billing,
  refreshedAt,
  dealFields,
  closedwonAt,
  contractEndField,
  clientId,
  clientName,
  onUpdated,
}: {
  billing: Billing | null;
  refreshedAt: string | null;
  dealFields: HubspotDealFields | null | undefined;
  closedwonAt: string | null;
  contractEndField: ClientFieldValue | null | undefined;
  clientId: string;
  clientName: string;
  onUpdated: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const missingRows = billing?.missing_rows ?? [];
  const linkModal = linkOpen && (
    <BillingLinkModal clientId={clientId} clientName={clientName} onClose={() => setLinkOpen(false)} onSaved={() => onUpdated()} />
  );

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
    <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={reload} disabled={reloading} title="Reload from the revenue file" style={{ marginRight: -8 }}>
      {reloading ? "Reloading…" : "Reload"}
      {reloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
    </button>
  );

  const contractStart = parseLooseDate(dealFields?.contract_start_date);
  const end = resolveContractEnd({ contractEndDate: dealFields?.contract_end_date, closedwonAt, conversationsField: contractEndField });
  const contractEnd = dealFields == null ? null : end.date;
  const toEnd = daysUntil(contractEnd);
  const endTone = contractEndTone(toEnd);
  const contractRows = (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "8px 14px",
        margin: 0,
        paddingTop: 14,
        borderTop: `1px solid ${COLORS.line}`,
        fontSize: 13,
      }}
    >
      <dt style={{ color: COLORS.ink3 }}>Contract</dt>
      <dd style={{ margin: 0, textAlign: "right", fontWeight: 600 }}>
        {dealFields == null
          ? <span style={{ color: COLORS.warn }}>HubSpot unreachable</span>
          : contractStart || contractEnd || end.rejected
            ? (
              <>
                {contractStart ? `${fmtDay(contractStart, true)} ` : ""}→ {contractEnd ? fmtDay(contractEnd, true) : end.rejected ? <InvalidContractEnd end={end} /> : "-"}
                <ContractEndOrigin end={end} compact />
              </>
            )
            : <span style={{ color: COLORS.warn }}>Dates missing in HubSpot</span>}
      </dd>
      {toEnd !== null && (
        <>
          <dt style={{ color: COLORS.ink3 }}>{toEnd >= 0 ? "Renewal in" : "Contract ended"}</dt>
          <dd style={{ margin: 0, textAlign: "right", fontWeight: 600, color: endTone === "err" ? COLORS.err : endTone === "warn" ? COLORS.warn : undefined }}>
            {toEnd >= 0 ? `${toEnd} days` : `${-toEnd} days ago`}
          </dd>
        </>
      )}
      {dealFields?.billing && (
        <>
          <dt style={{ color: COLORS.ink3 }}>Billing</dt>
          <dd style={{ margin: 0, textAlign: "right", fontWeight: 600 }}>{dealFields.billing}</dd>
        </>
      )}
    </dl>
  );

  if (!billing?.matched) {
    return (
      <Card style={{ display: "flex", flexDirection: "column" }}>
        <CardHeader title="Billing" right={reloadBtn} />
        <div style={{ padding: "12px 14px", borderRadius: 10, background: COLORS.warnTint, border: `1px solid ${COLORS.warnLine}` }}>
          <div style={{ fontSize: 13, color: COLORS.warn, fontWeight: 700 }}>
            {missingRows.length > 0 ? "Linked row not found in the revenue sheet" : "No match in the revenue sheet"}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 3, lineHeight: 1.5 }}>
            {missingRows.length > 0
              ? `${missingRows.join(", ")} ${missingRows.length > 1 ? "are" : "is"} no longer in the revenue file (renamed or removed), so billed revenue is unknown (not zero).`
              : "The company name was not found in the revenue file, so billed revenue is unknown (not zero)."}
          </div>
          <button type="button" className="ch-btn ch-btn-sm ch-btn-primary" onClick={() => setLinkOpen(true)} style={{ marginTop: 10 }}>
            <Link2 size={13} />
            {missingRows.length > 0 ? "Pick the new row" : "Link a row from the sheet"}
          </button>
        </div>
        {error && <div style={{ fontSize: 12, color: COLORS.err, marginTop: 6 }}>{error}</div>}
        <div style={{ marginTop: "auto", paddingTop: 16 }}>{contractRows}</div>
        {linkModal}
      </Card>
    );
  }

  // Lignes du sheet lues (billings d'avant le lien manuel : match_key "A + B").
  const sheetRows = billing.matched_rows ?? (billing.match_key ? billing.match_key.split(" + ") : []);

  const years = Object.keys(billing.revenue_by_year ?? {}).sort();
  const lastYears = years.slice(-5);
  const max = Math.max(1, ...lastYears.map((y) => billing.revenue_by_year?.[y] ?? 0));
  const currentYear = String(new Date().getFullYear());
  const yoy = billing.yoy_growth;
  const yoyUp = yoy != null && yoy >= 0;

  return (
    <Card style={{ display: "flex", flexDirection: "column" }}>
      <CardHeader title="Billing" meta={refreshedAt ? `Revenue sheet · ${fmtDay(refreshedAt)}` : "Revenue sheet"} right={reloadBtn} />
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
                    background: isCur ? COLORS.ink0 : COLORS.lineStrong,
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
      <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.45 }}>
        {sheetRows.length > 1 ? "Sheet rows" : "Sheet row"} <span style={{ color: COLORS.ink1, fontWeight: 600 }}>{sheetRows.join(" + ") || "-"}</span>
        {billing.match_source === "manual" ? " · linked by hand" : " · matched by name"} ·{" "}
        <button type="button" className="ch-link" onClick={() => setLinkOpen(true)} style={{ fontSize: 11.5, fontWeight: 500, color: COLORS.ink2 }}>
          Change
        </button>
      </div>
      {missingRows.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 11.5, color: COLORS.warn, lineHeight: 1.45 }}>
          Not in the sheet anymore: {missingRows.join(", ")}. Its revenue is not counted.
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: COLORS.err, marginTop: 6 }}>{error}</div>}
      <div style={{ marginTop: "auto", paddingTop: 16 }}>{contractRows}</div>
      {linkModal}
    </Card>
  );
}
