"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Check, Link2, Loader2, Search, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import { useToast } from "@/components/ui/toast";
import type { BillingLinkResponse, SheetRowOption } from "@/lib/clients/billing-link";
import type { Billing } from "@/lib/clients/types";
import { fmtEur } from "../[id]/_components/ui";

// Relier une fiche à sa ou ses lignes du sheet revenue (onglet Historique) quand
// le match par nom échoue ou se trompe (cf. lib/clients/billing-link.ts). Ouvert
// depuis la carte Billing de la fiche et depuis "Not in sheet" dans la liste.
// Multi-sélection : plusieurs lignes = un seul compte, montants additionnés.
// Ordre : lignes lues aujourd'hui, puis celles qui ressemblent au nom, puis le
// reste par ordre alphabétique.

async function fetcher(url: string): Promise<BillingLinkResponse> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as BillingLinkResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// "Not in sheet" cliquable des deux vues de /clients : ouvre le sélecteur sans
// naviguer (la ligne de la vue simple est un <Link>, celle de la vue avancée a
// un onRowClick).
export function NotInSheetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ch-link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title="Billed revenue unknown: link this account to its row of the revenue sheet"
      style={{ fontSize: 12, fontWeight: 600, color: COLORS.warn, textDecorationColor: COLORS.warnLine, whiteSpace: "nowrap" }}
    >
      {label} · Link
    </button>
  );
}

function RowOption({ r, year, selected, onToggle }: { r: SheetRowOption; year: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="ch-merge-row"
      style={{
        display: "grid",
        gridTemplateColumns: "18px minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        width: "100%",
        padding: "9px 12px",
        border: "none",
        borderBottom: `1px solid ${COLORS.line}`,
        background: selected ? COLORS.bgSoft : undefined,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          display: "grid",
          placeItems: "center",
          background: selected ? COLORS.primary : COLORS.bgCard,
          border: selected ? "none" : `1.5px solid ${COLORS.ink5}`,
          color: "#fff",
        }}
      >
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.company}
        </span>
        {(r.is_rfp || r.used_by.length > 0) && (
          <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[r.is_rfp && "RFP", r.used_by.length > 0 && `Already on ${r.used_by.map((u) => u.company_name).join(", ")}`].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: COLORS.ink1 }}>{fmtEur(r.total)}</span>
        <span style={{ display: "block", fontSize: 11, color: COLORS.ink3, marginTop: 1 }}>
          {year} {fmtEur(r.current_year)}
        </span>
      </span>
    </button>
  );
}

export function BillingLinkModal({
  clientId,
  clientName,
  onClose,
  onSaved,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onSaved: (billing: Billing) => void;
}) {
  const { toast } = useToast();
  const { data, error, isLoading } = useSWR<BillingLinkResponse>(`/api/clients/${clientId}/billing-link`, fetcher, {
    revalidateOnFocus: false,
  });
  const [query, setQuery] = useState("");
  // null = pas encore touché : la sélection part des lignes lues aujourd'hui.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const selected = useMemo(() => picked ?? new Set(data?.current ?? []), [picked, data]);
  const inSheet = useMemo(() => new Set((data?.rows ?? []).map((r) => r.company)), [data]);
  // Lignes reliées à la main qui ne sont plus dans le sheet (renommées, supprimées).
  const missing = (data?.linked ?? []).filter((name) => !inSheet.has(name));
  const valid = [...selected].filter((name) => inSheet.has(name));

  const sections = useMemo(() => {
    const q = fold(query.trim());
    const current = new Set(data?.current ?? []);
    const list = (data?.rows ?? []).filter((r) => !q || fold(r.company).includes(q));
    return [
      { label: data?.linked ? "Linked now" : "Matched by name now", rows: list.filter((r) => current.has(r.company)) },
      { label: `Looks like ${clientName}`, rows: list.filter((r) => !current.has(r.company) && r.suggested) },
      { label: "All rows", rows: list.filter((r) => !current.has(r.company) && !r.suggested) },
    ].filter((s) => s.rows.length > 0);
  }, [data, query, clientName]);

  function toggle(company: string) {
    setSubmitError(null);
    setPicked(() => {
      const next = new Set(selected);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  }

  async function save(rows: string[]) {
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/billing-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; billing?: Billing };
      if (!res.ok || !body.billing) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(rows.length ? `Billing linked to ${rows.join(" + ")}` : "Back to automatic match by name", "success");
      onSaved(body.billing);
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save the link");
      setSaving(false);
    }
  }

  const unchanged = !!data?.linked && valid.length === data.linked.length && valid.every((name) => data.linked?.includes(name));

  const sectionLabel: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: COLORS.ink3,
    padding: "10px 12px 4px",
  };

  return (
    <div
      role="presentation"
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-link-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 600,
          background: COLORS.bgCard,
          borderRadius: 16,
          boxShadow: SHADOWS.pop,
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 22px 0" }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: COLORS.sand, color: COLORS.primary }}>
            <Link2 size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="billing-link-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Link {clientName} to the revenue sheet
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.ink2, lineHeight: 1.45 }}>
              Pick the row of the Historique tab for this account. Several rows are added up. The link is kept on every refresh.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }} disabled={saving}>
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar" style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.ink3, fontSize: 13 }}>
              <Loader2 size={14} className="animate-spin" /> Reading the revenue sheet…
            </div>
          ) : error ? (
            <div style={{ fontSize: 13, color: COLORS.err }}>{error instanceof Error ? error.message : "Could not read the revenue sheet"}</div>
          ) : (
            <>
              {missing.length > 0 && (
                <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: COLORS.warnTint, border: `1px solid ${COLORS.warnLine}`, fontSize: 12.5, color: COLORS.ink1, lineHeight: 1.45 }}>
                  <b style={{ color: COLORS.warn }}>No longer in the sheet:</b> {missing.join(", ")}. The row was renamed or removed, pick its new row.
                </div>
              )}
              <label className="ds-input ds-input-sm ds-input-wrap" style={{ width: "100%", padding: "7px 11px" }}>
                <Search size={14} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a company of the sheet…" aria-label="Search a row" autoFocus />
              </label>
              <div style={{ marginTop: 12, border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                {sections.map((s) => (
                  <div key={s.label}>
                    <div style={sectionLabel}>{s.label}</div>
                    {s.rows.map((r) => (
                      <RowOption key={r.company} r={r} year={data?.year ?? ""} selected={selected.has(r.company)} onToggle={() => toggle(r.company)} />
                    ))}
                  </div>
                ))}
                {sections.length === 0 && <div style={{ padding: 14, fontSize: 13, color: COLORS.ink3 }}>No row matches this search.</div>}
              </div>
            </>
          )}
          {submitError && <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.err }}>{submitError}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderTop: `1px solid ${COLORS.line}`, background: COLORS.bgSoft }}>
          {data?.linked && (
            <button
              type="button"
              className="ch-btn ch-btn-sm ch-btn-ghost"
              onClick={() => void save([])}
              disabled={saving}
              title="Remove the link: the page is matched by its company name again"
            >
              Use automatic match
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="ch-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="ch-btn ch-btn-primary"
            onClick={() => void save(valid)}
            disabled={saving || !data || valid.length === 0 || unchanged}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            {saving ? "Saving…" : valid.length > 1 ? `Link ${valid.length} rows` : "Link this row"}
          </button>
        </div>
      </div>
    </div>
  );
}
