"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { lossReasonLabel } from "@/lib/deals/loss-analysis";
import type { LostSort } from "@/lib/hooks/use-lost-deals";
import type { LostDeal } from "../_helpers";
import { fmt, lostWhen } from "../_helpers";

export const LOST_COLUMN_WIDTH = 280;
const LOST_DOT = "#b91c1c";

const pill: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 99 };

// Date de relance de l'analyse : "Reopen Mar 2027", en orange une fois passée.
function ReopenPill({ date }: { date: string }) {
  const overdue = date < new Date().toISOString().slice(0, 10);
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <span
      style={{ ...pill, background: overdue ? COLORS.warnBg : COLORS.ink0, color: overdue ? COLORS.warn : "#fff", whiteSpace: "nowrap" }}
      title={overdue ? "Reopen date has passed" : "Suggested reopen date"}
    >
      {overdue ? `Reopen overdue · ${label}` : `Reopen ${label}`}
    </span>
  );
}

// Statut de la carte : analysée (date de relance + cause), en cours, sinon la
// raison saisie dans HubSpot telle quelle.
export function LostStatus({ deal }: { deal: LostDeal }) {
  const a = deal.lossAnalysis;
  if (a?.status === "done") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {a.reopenDate ? (
          <ReopenPill date={a.reopenDate} />
        ) : (
          <span style={{ ...pill, background: COLORS.ink0, color: "#fff" }}>Analyzed</span>
        )}
        <span style={{ ...pill, background: COLORS.errBg, color: LOST_DOT }}>
          {lossReasonLabel(a.primaryReason)}
        </span>
      </span>
    );
  }
  if (a?.status === "analyzing") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: COLORS.ink2 }}>
        <RefreshCw size={11} className="animate-spin" /> Analyzing…
      </span>
    );
  }
  return deal.declaredReason ? (
    <span style={{ fontSize: 12, color: COLORS.ink2, lineHeight: 1.4, overflowWrap: "anywhere" }}>Reason: {deal.declaredReason}</span>
  ) : (
    <span style={{ fontSize: 12, color: COLORS.warn, fontStyle: "italic" }}>No reason logged</span>
  );
}

const LostCard = React.memo(function LostCard({ deal, onClick }: { deal: LostDeal; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ds-card ds-card-hover"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        width: "100%",
        padding: "12px 14px",
        marginBottom: 8,
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, width: "100%" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.ink0, lineHeight: 1.3, minWidth: 0, overflowWrap: "anywhere" }}>
          {deal.dealname || "Untitled"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink2, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {fmt(deal.amount)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2, minWidth: 0 }}>
        {deal.ownerName && (
          <>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{deal.ownerName}</span>
            <span aria-hidden="true" style={{ color: COLORS.ink4 }}>·</span>
          </>
        )}
        <span style={{ color: LOST_DOT, fontWeight: 600, whiteSpace: "nowrap" }}>{lostWhen(deal.lostAt)}</span>
      </div>
      <LostStatus deal={deal} />
    </button>
  );
});

const SORT_OPTIONS: { key: LostSort; label: string }[] = [
  { key: "lost", label: "Lost date" },
  { key: "reopen", label: "Reopen date" },
];

// Dernière colonne du board : deals perdus, triés par date de perte (le plus
// récent en haut) ou par date de relance (la plus proche en haut, deals
// analysés seulement). Pas de total en euros (ce n'est pas du pipeline).
export function LostKanbanColumn({
  deals,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  sort,
  sortLocked,
  onSortChange,
}: {
  deals: LostDeal[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (d: LostDeal) => void;
  sort: LostSort;
  // Recherche active : elle passe par HubSpot et impose le tri par date de perte.
  sortLocked: boolean;
  onSortChange: (s: LostSort) => void;
}) {
  const effectiveSort: LostSort = sortLocked ? "lost" : sort;
  return (
    <div
      style={{
        flex: `0 0 ${LOST_COLUMN_WIDTH}px`,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: 12,
        background: COLORS.bgSoft,
        outline: `1px dashed ${COLORS.lineStrong}`,
        outlineOffset: -1,
        padding: "10px 8px 0",
      }}
    >
      <div style={{ padding: "4px 6px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: LOST_DOT, flexShrink: 0 }} aria-hidden="true" />
          <span style={{ fontWeight: 600, fontSize: 13, color: COLORS.ink0 }}>Closed lost</span>
        </div>
        <div
          role="radiogroup"
          aria-label="Sort lost deals"
          style={{ display: "flex", gap: 2, marginTop: 8, padding: 2, borderRadius: 8, background: COLORS.bgCard, border: `1px solid ${COLORS.line}` }}
        >
          {SORT_OPTIONS.map((o) => {
            const active = effectiveSort === o.key;
            const disabled = sortLocked && o.key === "reopen";
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                title={disabled ? "Clear the search to sort by reopen date" : undefined}
                onClick={() => onSortChange(o.key)}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 6,
                  border: "none",
                  background: active ? COLORS.ink0 : "transparent",
                  color: active ? "#fff" : disabled ? COLORS.ink4 : COLORS.ink1,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 6, paddingLeft: 2 }}>
          {effectiveSort === "reopen" ? "Next reopening first, analyzed deals only" : "Newest loss first"}
        </div>
      </div>
      <div className="thin-scrollbar" style={{ flex: 1, overflowY: "auto", paddingBottom: 8, paddingRight: 2 }}>
        {error ? (
          <div style={{ fontSize: 12, color: COLORS.err, padding: "8px 6px", lineHeight: 1.45 }}>
            Could not load lost deals: {error}
          </div>
        ) : loading ? (
          <div style={{ fontSize: 12, color: COLORS.ink3, padding: "16px 0", textAlign: "center" }}>Loading…</div>
        ) : deals.length === 0 ? (
          <div style={{ textAlign: "center", fontSize: 12, color: COLORS.ink4, padding: "16px 0" }}>
            {effectiveSort === "reopen" ? "No analyzed lost deal yet" : "No lost deal"}
          </div>
        ) : (
          <>
            {deals.map((d) => (
              <LostCard key={d.id} deal={d} onClick={() => onSelect(d)} />
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                style={{
                  width: "100%",
                  padding: "9px 0",
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgCard,
                  color: COLORS.ink1,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loadingMore ? "default" : "pointer",
                }}
              >
                {loadingMore ? "Loading…" : "Show older"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
