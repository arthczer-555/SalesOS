"use client";

import * as React from "react";
import {
  X,
  Search,
  ExternalLink,
  Trophy,
  XCircle,
  Activity,
  Mail,
  Linkedin,
  CheckSquare,
  Square,
  Star,
  Plus,
  Loader2,
} from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentProfile } from "@/lib/intel-types";

const LIFECYCLE_COLORS: Record<string, { fg: string; bg: string }> = {
  customer: { fg: COLORS.ok, bg: COLORS.okBg },
  evangelist: { fg: COLORS.brand, bg: COLORS.brandTint },
  opportunity: { fg: COLORS.info, bg: COLORS.infoBg },
  salesqualifiedlead: { fg: COLORS.warn, bg: COLORS.warnBg },
  marketingqualifiedlead: { fg: "#0891b2", bg: "#cffafe" },
  lead: { fg: COLORS.ink2, bg: COLORS.bgSoft },
  subscriber: { fg: COLORS.ink3, bg: COLORS.bgSoft },
};

function fmtMoney(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const n = parseFloat(amount);
  if (Number.isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k€`;
  return `${Math.round(n)}€`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "aujourd'hui";
  if (d < 30) return `il y a ${d}j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)}m`;
  return `il y a ${Math.floor(d / 365)}a`;
}

export interface LoadMoreResult {
  profiles: EnrichmentProfile[];
  skippedByRadar: number;
  hasMore: boolean;
}

interface HubspotImportModalProps {
  profiles: EnrichmentProfile[];
  initialHasMore?: boolean;
  initialSkippedByRadar?: number;
  onLoadMore?: (excludeIds: string[]) => Promise<LoadMoreResult>;
  onClose: () => void;
  onConfirm: (selected: EnrichmentProfile[], options?: { isChampion?: boolean }) => void;
}

export function HubspotImportModal({
  profiles,
  initialHasMore = false,
  initialSkippedByRadar = 0,
  onLoadMore,
  onClose,
  onConfirm,
}: HubspotImportModalProps) {
  const [markAsChampion, setMarkAsChampion] = React.useState(false);
  const idOf = (p: EnrichmentProfile) => p.hubspotId ?? p.email ?? p.fullName;

  // Liste cumulée (le "Charger plus" l'augmente)
  const [allProfiles, setAllProfiles] = React.useState<EnrichmentProfile[]>(profiles);
  const [hasMore, setHasMore] = React.useState(initialHasMore);
  const [skippedByRadar, setSkippedByRadar] = React.useState(initialSkippedByRadar);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreErr, setLoadMoreErr] = React.useState<string | null>(null);

  // Toggle local de sélection (toutes cochées par défaut)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    new Set(profiles.map((p) => p.hubspotId ?? p.email ?? p.fullName))
  );
  const [q, setQ] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<"all" | "selected" | "unselected">("all");
  const [quickFilter, setQuickFilter] = React.useState<"all" | "with-email" | "with-linkedin" | "no-linkedin" | "won" | "lost" | "open">("all");

  async function handleLoadMore() {
    if (!onLoadMore || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreErr(null);
    try {
      const excludeIds = allProfiles.map((p) => p.hubspotId).filter((x): x is string => !!x);
      const r = await onLoadMore(excludeIds);
      // dédup défensif par hubspotId
      const knownIds = new Set(excludeIds);
      const fresh = r.profiles.filter((p) => !p.hubspotId || !knownIds.has(p.hubspotId));
      setAllProfiles((cur) => [...cur, ...fresh]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of fresh) next.add(idOf(p));
        return next;
      });
      setSkippedByRadar((n) => n + r.skippedByRadar);
      setHasMore(r.hasMore && fresh.length > 0);
    } catch (e) {
      setLoadMoreErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoadingMore(false);
    }
  }

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = React.useMemo(() => {
    return allProfiles.filter((p) => {
      const id = idOf(p);
      const sel = selectedIds.has(id);
      if (filterMode === "selected" && !sel) return false;
      if (filterMode === "unselected" && sel) return false;

      if (quickFilter === "with-email" && !p.email) return false;
      if (quickFilter === "with-linkedin" && !p.username) return false;
      if (quickFilter === "no-linkedin" && p.username) return false;
      if (quickFilter === "won" && !p.topDeal?.isWon) return false;
      if (quickFilter === "lost" && !(p.topDeal?.isClosed && !p.topDeal?.isWon)) return false;
      if (quickFilter === "open" && !p.topDeal && !p.topDeal) return false;
      if (quickFilter === "open" && !(p.topDeal && !p.topDeal.isClosed)) return false;

      if (q.trim()) {
        const needle = q.toLowerCase();
        return (
          p.fullName.toLowerCase().includes(needle) ||
          (p.email?.toLowerCase().includes(needle) ?? false) ||
          (p.company?.toLowerCase().includes(needle) ?? false) ||
          (p.jobTitle?.toLowerCase().includes(needle) ?? false)
        );
      }
      return true;
    });
  }, [allProfiles, q, selectedIds, filterMode, quickFilter]);

  const selectAll = () => setSelectedIds(new Set(allProfiles.map(idOf)));
  const deselectAll = () => setSelectedIds(new Set());
  const selectFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of filtered) next.add(idOf(p));
      return next;
    });
  };
  const deselectFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of filtered) next.delete(idOf(p));
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const total = allProfiles.length;

  const confirm = () => {
    const selected = allProfiles
      .filter((p) => selectedIds.has(idOf(p)))
      .map((p) => ({ ...p, selected: true, isChampion: markAsChampion || p.isChampion }));
    onConfirm(selected, { isChampion: markAsChampion });
  };

  // Lock body scroll
  React.useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "90vh",
          background: COLORS.bgCard,
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
              Aperçu des contacts à importer
            </h2>
            <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>
              {total} contact{total > 1 ? "s" : ""} chargé{total > 1 ? "s" : ""}
              {skippedByRadar > 0 && (
                <> · <strong style={{ color: COLORS.ink2 }}>{skippedByRadar}</strong> exclu{skippedByRadar > 1 ? "s" : ""} (déjà au Radar)</>
              )}
              {hasMore && <> · <strong style={{ color: COLORS.brand }}>plus dispos</strong></>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer", padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            padding: "10px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: COLORS.bgSoft,
          }}
        >
          <div style={{ position: "relative", minWidth: 220 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer dans la liste…"
              style={{
                width: "100%",
                paddingLeft: 30,
                paddingRight: 10,
                paddingTop: 6,
                paddingBottom: 6,
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
                fontSize: 12,
                outline: "none",
                background: COLORS.bgCard,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 4, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: 2, background: COLORS.bgCard }}>
            {(
              [
                { v: "all" as const, l: "Tous" },
                { v: "selected" as const, l: "Sélectionnés" },
                { v: "unselected" as const, l: "Non sél." },
              ] as const
            ).map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => setFilterMode(m.v)}
                style={modeBtn(filterMode === m.v)}
              >
                {m.l}
              </button>
            ))}
          </div>

          <select
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value as typeof quickFilter)}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              border: `1px solid ${COLORS.line}`,
              borderRadius: 6,
              background: COLORS.bgCard,
              outline: "none",
            }}
          >
            <option value="all">Tous les types</option>
            <option value="with-email">Avec email</option>
            <option value="with-linkedin">Avec LinkedIn</option>
            <option value="no-linkedin">Sans LinkedIn</option>
            <option value="won">Closed Won</option>
            <option value="lost">Closed Lost</option>
            <option value="open">Deal ouvert</option>
          </select>

          <span style={{ fontSize: 12, color: COLORS.ink2 }}>
            <strong style={{ color: COLORS.ink0 }}>{selectedCount}</strong>/{total} sélectionnés
            {filtered.length !== total && <> · {filtered.length} affiché{filtered.length > 1 ? "s" : ""}</>}
          </span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button type="button" onClick={selectAll} style={btnSm()}>
              Tout cocher
            </button>
            <button type="button" onClick={deselectAll} style={btnSm()}>
              Tout décocher
            </button>
            {filtered.length !== total && (
              <>
                <button type="button" onClick={selectFiltered} style={btnSm()} title="Cocher la vue filtrée">
                  Cocher visibles
                </button>
                <button type="button" onClick={deselectFiltered} style={btnSm()} title="Décocher la vue filtrée">
                  Décocher visibles
                </button>
              </>
            )}
          </div>
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <p style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
              Aucun contact ne correspond.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {filtered.map((p) => {
                const id = idOf(p);
                const selected = selectedIds.has(id);
                const lc = p.lifecyclestage ? LIFECYCLE_COLORS[p.lifecyclestage] ?? null : null;
                const dealAmount = fmtMoney(p.topDeal?.amount);
                const dealWon = p.topDeal?.isWon === true;
                const dealLost = p.topDeal?.isClosed === true && !dealWon;
                return (
                  <div
                    key={id}
                    onClick={() => toggle(id)}
                    style={{
                      padding: "10px 20px",
                      borderBottom: `1px solid ${COLORS.line}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      cursor: "pointer",
                      background: selected ? COLORS.brandTintSoft : "transparent",
                    }}
                  >
                    {selected ? (
                      <CheckSquare size={16} color={COLORS.brand} />
                    ) : (
                      <Square size={16} color={COLORS.ink4} />
                    )}
                    <CompanyAvatar name={p.fullName} size={32} rounded="full" />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.fullName}
                        </span>
                        {lc && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 99,
                              background: lc.bg,
                              color: lc.fg,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.lifecyclestage}
                          </span>
                        )}
                        {p.topDeal && (
                          <span
                            style={{
                              fontSize: 11,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              color: dealWon ? COLORS.ok : dealLost ? COLORS.err : COLORS.info,
                            }}
                            title={p.topDeal.name}
                          >
                            {dealWon ? <Trophy size={11} /> : dealLost ? <XCircle size={11} /> : <Activity size={11} />}
                            {p.topDeal.stageLabel ?? p.topDeal.stage}
                            {dealAmount && <strong>· {dealAmount}</strong>}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: COLORS.ink2,
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        {p.jobTitle && <span>{p.jobTitle}</span>}
                        {p.company && <span style={{ color: COLORS.ink3 }}>@ {p.company}</span>}
                        {p.email && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: COLORS.ink2 }}>
                            <Mail size={10} />
                            {p.email}
                          </span>
                        )}
                        {p.username && (
                          <a
                            href={p.profileUrl ?? `https://www.linkedin.com/in/${p.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0a66c2" }}
                          >
                            <Linkedin size={10} />
                            LinkedIn
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: COLORS.ink3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {p.ownerName && <span>Owner : {p.ownerName}</span>}
                        {p.numAssociatedDeals ? <span>{p.numAssociatedDeals} deal{p.numAssociatedDeals > 1 ? "s" : ""}</span> : null}
                        <span>Dernier contact : {timeAgo(p.lastContactedAt)}</span>
                        {p.createdAt && <span>Ajouté : {timeAgo(p.createdAt)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load more */}
          {onLoadMore && (hasMore || loadMoreErr) && (
            <div
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                borderTop: filtered.length > 0 ? `1px solid ${COLORS.line}` : "none",
              }}
            >
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore || !hasMore}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgCard,
                  color: hasMore && !loadingMore ? COLORS.ink1 : COLORS.ink3,
                  cursor: hasMore && !loadingMore ? "pointer" : "default",
                }}
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={13} />
                    Chargement…
                  </>
                ) : (
                  <>
                    <Plus size={13} />
                    Charger plus
                  </>
                )}
              </button>
              {loadMoreErr && (
                <span style={{ fontSize: 11, color: COLORS.err }}>Erreur : {loadMoreErr}</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: COLORS.ink2 }}>
            <strong style={{ color: COLORS.ink0 }}>{selectedCount}</strong> contact{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""}
          </span>
          <label
            style={{
              marginLeft: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: COLORS.ink1,
              cursor: "pointer",
            }}
            title="Les profils importés seront flaggés is_champion=true — champion-tracker les surveillera."
          >
            <input
              type="checkbox"
              checked={markAsChampion}
              onChange={(e) => setMarkAsChampion(e.target.checked)}
              style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
            />
            <Star size={12} color={markAsChampion ? COLORS.warn : COLORS.ink3} fill={markAsChampion ? COLORS.warn : "none"} />
            Marquer comme champions
          </label>
          <button type="button" onClick={onClose} style={{ ...btnSm(), marginLeft: "auto" }}>
            Annuler
          </button>
          <button type="button" onClick={confirm} disabled={selectedCount === 0} style={btnPrimary()}>
            Importer la sélection ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}

function modeBtn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 4,
    border: "none",
    background: active ? COLORS.brand : "transparent",
    color: active ? "white" : COLORS.ink2,
    cursor: "pointer",
  };
}

function btnSm(): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    padding: "7px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
  };
}
