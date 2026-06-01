"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { X, Download, Loader2, Search, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { MeetingConfirmationModal } from "../[id]/_components/meeting-confirmation-modal";

// Modal admin pour importer des closed-won historiques HubSpot vers la table
// clients. UX : un dropdown searchable (multi-select) qui liste tous les
// closed-won pas encore importés, l'admin coche ceux qu'il veut, click
// "Importer X deal(s)". L'API back ne fait QUE créer les rows (status=pending),
// l'enrichissement IA est lancé après, fiche par fiche.

type Candidate = {
  id: string;
  name: string;
  amount: number | null;
  closedate: string | null;
  owner_name: string | null;
};

type CandidatesResponse = {
  candidates: Candidate[];
  total: number;
  alreadyImported: number;
};

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function fmtAmount(n: number | null): string {
  if (n == null) return "—";
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k€`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function BackfillModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data, error: candidatesError, isLoading } = useSWR<CandidatesResponse>(
    open ? "/api/clients/backfill/candidates" : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; alreadyExisted: number; errors: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Id du client à confirmer (import single) → ouvre le popup de confirmation
  // des meetings par-dessus le modal d'import.
  const [confirmClientId, setConfirmClientId] = useState<string | null>(null);

  // Reset à chaque ouverture pour ne pas garder une sélection morte d'une
  // session précédente
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(new Set());
      setResult(null);
      setImportError(null);
      setConfirmClientId(null);
    }
  }, [open]);

  const candidates = data?.candidates ?? [];
  const filtered = useMemo(() => {
    if (!query.trim()) return candidates;
    const q = query.toLowerCase();
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.owner_name?.toLowerCase().includes(q) ||
        c.id.includes(q),
    );
  }, [candidates, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.id);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function runImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setImportError(null);
    setResult(null);
    try {
      const res = await fetch("/api/clients/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: Array.from(selected) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        imported?: number;
        alreadyExisted?: number;
        errors?: number;
        singleClientId?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult({
        imported: body.imported ?? 0,
        alreadyExisted: body.alreadyExisted ?? 0,
        errors: body.errors ?? 0,
      });
      // Import d'un seul deal : on ouvre directement le popup de confirmation
      // des meetings (les autres cas se confirment depuis chaque fiche).
      if (body.singleClientId) setConfirmClientId(body.singleClientId);
      onDone();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  return (
    <>
    {confirmClientId && (
      <MeetingConfirmationModal
        clientId={confirmClientId}
        onClose={() => setConfirmClientId(null)}
        onConfirmed={onDone}
        onDeleted={() => {
          setConfirmClientId(null);
          onDone();
        }}
      />
    )}
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bgCard,
          borderRadius: 12,
          padding: 20,
          width: 600,
          maxWidth: "92vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.ink0 }}>
            Importer des closed-won
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.ink3, padding: 4 }}
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: 12, color: COLORS.ink2, marginBottom: 12, lineHeight: 1.5 }}>
          Coche les deals à importer. Crée une fiche client en attente
          d&apos;enrichissement. Tu lances Claude ensuite, fiche par fiche.
        </p>

        {/* Search bar */}
        <div style={{ position: "relative", marginBottom: 10, flexShrink: 0 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: COLORS.ink3,
            }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un deal (nom, owner, id)…"
            disabled={isLoading}
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 13,
              outline: "none",
              background: COLORS.bgSoft,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Bulk select bar */}
        {!isLoading && !candidatesError && candidates.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
              fontSize: 11,
              color: COLORS.ink3,
              flexShrink: 0,
            }}
          >
            <span>
              {selected.size} sélectionné(s) sur {filtered.length} affiché(s)
              {data && (
                <>
                  {" "}· {candidates.length} disponibles
                  {data.alreadyImported > 0 && (
                    <span style={{ color: COLORS.ink4 }}> · {data.alreadyImported} déjà importés</span>
                  )}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: COLORS.brand,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Cocher les {filtered.length} affichés
            </button>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  background: "none",
                  border: "none",
                  color: COLORS.ink2,
                  fontSize: 11,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Tout décocher
              </button>
            )}
          </div>
        )}

        {/* List */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            background: COLORS.bgSoft,
            minHeight: 200,
          }}
        >
          {isLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
              Chargement des closed-won HubSpot…
            </div>
          ) : candidatesError ? (
            <div style={{ padding: 20, textAlign: "center", color: COLORS.err, fontSize: 13 }}>
              {candidatesError instanceof Error ? candidatesError.message : "Erreur"}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
              {query ? "Aucun deal ne matche cette recherche." : "Aucun deal à importer."}
            </div>
          ) : (
            filtered.map((c) => {
              const isSel = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 80px 110px",
                    gap: 10,
                    alignItems: "center",
                    width: "100%",
                    padding: "8px 12px",
                    background: isSel ? COLORS.brandTintSoft : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${COLORS.line}`,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) e.currentTarget.style.background = COLORS.bgCard;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `1px solid ${isSel ? COLORS.brand : COLORS.lineStrong}`,
                      background: isSel ? COLORS.brand : "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isSel && <Check size={11} strokeWidth={3} color="white" />}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: COLORS.ink0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 1 }}>
                      {c.owner_name || "Sans owner"} · #{c.id}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: COLORS.ink1, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {fmtAmount(c.amount)}
                  </span>
                  <span style={{ fontSize: 11, color: COLORS.ink2, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {fmtDate(c.closedate)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Result / error */}
        {result && (
          <div
            style={{
              background: COLORS.okBg,
              color: COLORS.ok,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12,
              marginTop: 12,
              flexShrink: 0,
            }}
          >
            <strong>{result.imported}</strong> deal(s) importé(s)
            {result.alreadyExisted > 0 && <>, <strong>{result.alreadyExisted}</strong> déjà présent(s)</>}
            {result.errors > 0 && <>, <strong>{result.errors}</strong> erreur(s)</>}.
            {result.imported > 1 && (
              <div style={{ marginTop: 4, color: COLORS.ink2 }}>
                Confirme les meetings depuis chaque fiche (les AE ont été notifiés sur Slack), puis l&apos;analyse
                démarre.
              </div>
            )}
          </div>
        )}
        {importError && (
          <div
            style={{
              background: COLORS.errBg,
              color: COLORS.err,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12,
              marginTop: 12,
              flexShrink: 0,
            }}
          >
            {importError}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: importing ? "not-allowed" : "pointer",
            }}
          >
            {result ? "Fermer" : "Annuler"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={runImport}
              disabled={importing || selected.size === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 8,
                border: `1px solid ${COLORS.brand}`,
                background: importing || selected.size === 0 ? COLORS.bgSoft : COLORS.brand,
                color: importing || selected.size === 0 ? COLORS.ink3 : "white",
                cursor: importing || selected.size === 0 ? "not-allowed" : "pointer",
              }}
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {importing ? "Importation…" : `Importer ${selected.size || ""} deal${selected.size > 1 ? "s" : ""}`.trim()}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
