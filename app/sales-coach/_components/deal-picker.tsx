"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Building2, CheckCircle2, Loader2, Search } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

export type DealSearchResult = {
  id: string;
  name: string;
  stage_label: string | null;
  pipeline_label: string | null;
  amount: number | null;
  close_date: string | null;
  owner_name: string | null;
  is_closed_won: boolean;
  is_closed: boolean;
};

interface Props {
  /** Libellé du bouton de confirmation ("Link and start the analysis"…). */
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (deal: DealSearchResult) => void;
  /** Appelé dès que l'utilisateur retape ou change de deal (pour effacer une erreur affichée par le parent). */
  onSelectionChange?: () => void;
  /** Deal déjà rattaché : affiché dans les résultats mais non sélectionnable. */
  currentDealId?: string | null;
}

function formatAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return `${amount.toLocaleString("en-GB")}€`;
}

function formatCloseDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB");
}

/**
 * Recherche d'un deal HubSpot par nom (autocomplete) + carte du deal choisi
 * avec bouton de confirmation. Partagé par l'écran "No HubSpot deal found"
 * (ManualDealResolution) et par "Link a deal" / "Change deal" de la fiche.
 */
export function DealPicker({
  confirmLabel,
  busyLabel,
  busy,
  error,
  onConfirm,
  onSelectionChange,
  currentDealId,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealSearchResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Autocomplete debouncé : déclenche la recherche 250ms après la dernière
  // frappe pour éviter de spammer HubSpot. Annule la requête en cours quand
  // l'utilisateur tape plus, pour ne pas afficher de résultats périmés.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/hubspot/deals/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { deals?: DealSearchResult[] };
        setResults(data.deals ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, display: "block", marginBottom: 8 }}>
        HubSpot deal name
      </label>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search
          size={14}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: COLORS.ink3,
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          placeholder="Type the deal name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedDeal(null);
            onSelectionChange?.();
          }}
          autoFocus
          style={{
            width: "100%",
            paddingLeft: 36,
            paddingRight: 36,
            paddingTop: 9,
            paddingBottom: 9,
            fontSize: 13,
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            outline: "none",
            color: COLORS.ink0,
          }}
        />
        {searching && (
          <Loader2
            size={14}
            className="animate-spin"
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: COLORS.ink3,
            }}
          />
        )}
      </div>

      {/* Liste résultats */}
      {query.trim().length >= 2 && !selectedDeal && (
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            background: "#fff",
          }}
        >
          {!searching && results.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: COLORS.ink3, textAlign: "center" }}>
              No deal found for &laquo; {query.trim()} &raquo;.
            </div>
          )}
          {results.map((d) => {
            const amount = formatAmount(d.amount);
            const close = formatCloseDate(d.close_date);
            const isCustomer = d.is_closed_won;
            const isCurrent = !!currentDealId && d.id === currentDealId;
            return (
              <button
                key={d.id}
                onClick={() => {
                  if (isCurrent) return;
                  setSelectedDeal(d);
                  onSelectionChange?.();
                }}
                disabled={isCurrent}
                title={isCurrent ? "This meeting is already linked to this deal" : undefined}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${COLORS.line}`,
                  background: "#fff",
                  cursor: isCurrent ? "not-allowed" : "pointer",
                  opacity: isCurrent ? 0.55 : 1,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = COLORS.bgSoft;
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <Building2 size={13} style={{ color: COLORS.brand, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.name || `Deal ${d.id}`}
                  </span>
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: COLORS.bgSoft,
                        color: COLORS.ink2,
                        flexShrink: 0,
                      }}
                    >
                      CURRENT
                    </span>
                  )}
                  {isCustomer && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "#dcfce7",
                        color: "#166534",
                        flexShrink: 0,
                      }}
                    >
                      CLIENT
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink2, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {d.stage_label && <span>{d.stage_label}</span>}
                  {d.pipeline_label && <span style={{ color: COLORS.ink3 }}>· {d.pipeline_label}</span>}
                  {amount && <span>· {amount}</span>}
                  {close && <span>· {close}</span>}
                  {d.owner_name && <span>· {d.owner_name}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Carte deal sélectionné + submit */}
      {selectedDeal && (
        <div
          style={{
            marginTop: 4,
            padding: 14,
            borderRadius: 10,
            background: "#f0fdf4",
            border: "1px solid #86efac",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <CheckCircle2 size={14} style={{ color: "#166534" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Selected deal</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, marginBottom: 4 }}>
            {selectedDeal.name || `Deal ${selectedDeal.id}`}
          </div>
          <div style={{ fontSize: 11, color: COLORS.ink2, display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {selectedDeal.stage_label && <span>{selectedDeal.stage_label}</span>}
            {formatAmount(selectedDeal.amount) && <span>· {formatAmount(selectedDeal.amount)}</span>}
            {selectedDeal.owner_name && <span>· {selectedDeal.owner_name}</span>}
            {selectedDeal.is_closed_won && (
              <span style={{ color: "#166534", fontWeight: 600 }}>· client (closed-won)</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onConfirm(selectedDeal)}
              disabled={busy}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                background: COLORS.brand,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {busy ? busyLabel : confirmLabel}
            </button>
            <button
              onClick={() => {
                setSelectedDeal(null);
                onSelectionChange?.();
              }}
              disabled={busy}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: "#fff",
                color: COLORS.ink2,
                fontSize: 13,
                fontWeight: 500,
                border: `1px solid ${COLORS.lineStrong}`,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Change
            </button>
          </div>
          {error && (
            <div style={{ marginTop: 10, fontSize: 12, color: COLORS.err, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={12} />
              {error}
            </div>
          )}
        </div>
      )}

      {query.trim().length > 0 && query.trim().length < 2 && (
        <div style={{ fontSize: 11, color: COLORS.ink3 }}>
          Type at least 2 characters to search.
        </div>
      )}
    </div>
  );
}
