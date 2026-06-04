"use client";

import * as React from "react";
import { Search, Loader2, Cloud, X, Filter as FilterIcon } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { HubspotCompanyRow } from "./hubspot-company-row";
import { SalesRail, type RailRep } from "./sales-rail";
import { ConfigureRepsDialog } from "./configure-reps-dialog";
import { DND_MIME, type HubspotPreviewCompany } from "./types";
import type { HubspotOwner } from "@/lib/intel-types";
import type { RosterRep } from "@/app/api/intel/admin/sales-reps/route";

const PAGE_SIZE = 50;
const ALL = "__all__";

const LIFECYCLES: { value: string; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "marketingqualifiedlead", label: "MQL" },
  { value: "salesqualifiedlead", label: "SQL" },
  { value: "opportunity", label: "Opportunity" },
  { value: "customer", label: "Customer" },
  { value: "subscriber", label: "Subscriber" },
];

export function AttributionView() {
  // Filtres HubSpot
  const [q, setQ] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [employeesMin, setEmployeesMin] = React.useState("");
  const [employeesMax, setEmployeesMax] = React.useState("");
  const [lifecycles, setLifecycles] = React.useState<Set<string>>(new Set());
  const [ownerId, setOwnerId] = React.useState("");
  const [sortRecent, setSortRecent] = React.useState(false);
  const [showFilters, setShowFilters] = React.useState(false);

  const [owners, setOwners] = React.useState<HubspotOwner[]>([]);
  const [results, setResults] = React.useState<HubspotPreviewCompany[]>([]);
  const [nextAfter, setNextAfter] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [localFilter, setLocalFilter] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  // Sélection + drag
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [draggingIds, setDraggingIds] = React.useState<Set<string>>(new Set());
  const anchorRef = React.useRef<string | null>(null);

  // Scope (pour annoter "déjà dans la watchlist · owner") + roster (drop rail)
  const [scopeOwnerByName, setScopeOwnerByName] = React.useState<Map<string, string | null>>(new Map());
  const [roster, setRoster] = React.useState<RosterRep[]>([]);
  const [showConfigure, setShowConfigure] = React.useState(false);

  const reloadScope = React.useCallback(async () => {
    const j = await fetch("/api/intel/admin/scope-companies").then((r) => r.json());
    const m = new Map<string, string | null>();
    for (const c of (j.companies ?? []) as Array<{ name: string; owner: string | null }>) {
      m.set((c.name ?? "").trim().toLowerCase(), c.owner ?? null);
    }
    setScopeOwnerByName(m);
  }, []);

  const reloadRoster = React.useCallback(async () => {
    const j = await fetch("/api/intel/admin/sales-reps?withCounts=1").then((r) => r.json());
    setRoster(j.reps ?? []);
  }, []);

  React.useEffect(() => {
    fetch("/api/intel/enrich/hubspot-owners")
      .then((r) => r.json())
      .then((j) => setOwners(j.owners ?? []))
      .catch(() => {});
    void reloadScope();
    void reloadRoster();
  }, [reloadScope, reloadRoster]);

  // Chargement initial : on affiche directement les companies HubSpot (1re page,
  // sans filtre). La recherche/les filtres servent à affiner ensuite.
  const didInit = React.useRef(false);
  React.useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildFilters(): Record<string, unknown> {
    const f: Record<string, unknown> = {};
    if (q.trim()) f.q = q.trim();
    if (industry.trim()) f.industry = [industry.trim()];
    if (country.trim()) f.country = [country.trim()];
    if (lifecycles.size > 0) f.lifecyclestage = Array.from(lifecycles);
    if (employeesMin) f.employeesMin = Number(employeesMin);
    if (employeesMax) f.employeesMax = Number(employeesMax);
    if (ownerId) f.ownerId = ownerId;
    if (sortRecent) f.sort = "created-desc";
    return f;
  }

  async function search(reset = true) {
    if (reset) {
      setSearching(true);
      setResults([]);
      setSelectedIds(new Set());
      setNextAfter(null);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/intel/admin/scope-companies/hubspot-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: buildFilters(), dryRun: true, pageSize: PAGE_SIZE, after: reset ? undefined : nextAfter }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erreur recherche");
      const preview = (j.preview ?? []) as HubspotPreviewCompany[];
      setResults((prev) => {
        if (reset) return preview;
        const seen = new Set(prev.map((p) => p.hubspotId));
        return [...prev, ...preview.filter((m) => !seen.has(m.hubspotId))];
      });
      setNextAfter(j.nextAfter ?? null);
      setHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }

  function ownerOf(name: string): string | null {
    return scopeOwnerByName.get(name.trim().toLowerCase()) ?? null;
  }

  // ── Filtrage local des résultats ─────────────────────────────────────
  const lf = localFilter.trim().toLowerCase();
  const visible = React.useMemo(
    () =>
      results.filter((r) => {
        if (!lf) return true;
        return (
          r.name.toLowerCase().includes(lf) ||
          (r.domain ?? "").toLowerCase().includes(lf) ||
          (r.industry ?? "").toLowerCase().includes(lf) ||
          (r.country ?? "").toLowerCase().includes(lf)
        );
      }),
    [results, lf],
  );

  // ── Sélection ────────────────────────────────────────────────────────
  function handleSelect(id: string, e: React.MouseEvent) {
    if (e.shiftKey && anchorRef.current) {
      const order = visible.map((r) => r.hubspotId);
      const a = order.indexOf(anchorRef.current);
      const b = order.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(order[i]);
          return next;
        });
        return;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }

  // ── Drag & drop ──────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, company: HubspotPreviewCompany) {
    const ids = selectedIds.has(company.hubspotId) ? Array.from(selectedIds) : [company.hubspotId];
    e.dataTransfer.setData(DND_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    const pill = document.createElement("div");
    pill.textContent = ids.length > 1 ? `${ids.length} companies` : company.name;
    Object.assign(pill.style, {
      position: "absolute", top: "-1000px", left: "-1000px", padding: "6px 12px",
      borderRadius: "999px", background: COLORS.brand, color: "#fff", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap",
    } as CSSStyleDeclaration);
    document.body.appendChild(pill);
    e.dataTransfer.setDragImage(pill, 12, 12);
    setTimeout(() => document.body.removeChild(pill), 0);
    setDraggingIds(new Set(ids));
  }

  async function assignDrop(ownerName: string | null) {
    const ids = Array.from(draggingIds);
    setDraggingIds(new Set());
    if (!ownerName || ids.length === 0) return;
    // optimiste : annoter les lignes concernées
    const names = results.filter((r) => ids.includes(r.hubspotId)).map((r) => r.name);
    setScopeOwnerByName((prev) => {
      const next = new Map(prev);
      for (const n of names) next.set(n.trim().toLowerCase(), ownerName);
      return next;
    });
    setResults((prev) => prev.map((r) => (ids.includes(r.hubspotId) ? { ...r, alreadyInScope: true } : r)));
    setSelectedIds(new Set());
    try {
      const res = await fetch("/api/intel/admin/scope-companies/hubspot-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: {}, dryRun: false, selectedIds: ids, defaultOwner: ownerName, mode: "update" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Erreur d'attribution");
        await reloadScope();
      }
      await reloadRoster();
    } catch {
      setError("Erreur réseau");
      await reloadScope();
    }
  }

  // ── Rail (roster, cibles de drop) ────────────────────────────────────
  const railReps: RailRep[] = React.useMemo(
    () => roster.map((r) => ({ id: r.id, name: r.name, email: r.email, count: r.account_count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [roster],
  );

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
      {/* Zone principale : recherche + résultats */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Barre de recherche HubSpot */}
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgCard, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Cloud size={14} style={{ color: COLORS.brand }} />
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Chercher des companies HubSpot (nom, domaine)…"
                style={{ width: "100%", paddingLeft: 30, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 12, outline: "none", background: COLORS.bgCard }}
              />
            </div>
            <button type="button" onClick={() => setShowFilters((v) => !v)} style={ghostBtn(showFilters)}>
              <FilterIcon size={12} /> Filtres
            </button>
            <button type="button" onClick={() => search()} disabled={searching} style={primaryBtn(!searching)}>
              {searching ? <Loader2 size={13} className="animate-spin" /> : "Rechercher"}
            </button>
          </div>

          {showFilters && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 4 }}>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (ex: LUXURY_GOODS)" style={inp(180)} />
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Pays" style={inp(120)} />
              <input value={employeesMin} onChange={(e) => setEmployeesMin(e.target.value)} placeholder="Empl. min" style={inp(90)} />
              <input value={employeesMax} onChange={(e) => setEmployeesMax(e.target.value)} placeholder="Empl. max" style={inp(90)} />
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ ...inp(150), cursor: "pointer" }}>
                <option value="">Owner HubSpot : tous</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {LIFECYCLES.map((l) => {
                  const on = lifecycles.has(l.value);
                  return (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() =>
                        setLifecycles((prev) => {
                          const next = new Set(prev);
                          if (next.has(l.value)) next.delete(l.value);
                          else next.add(l.value);
                          return next;
                        })
                      }
                      style={{ padding: "5px 9px", fontSize: 11, borderRadius: 999, border: `1px solid ${on ? COLORS.brand : COLORS.line}`, background: on ? COLORS.brand : COLORS.bgCard, color: on ? "#fff" : COLORS.ink2, cursor: "pointer" }}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: COLORS.ink2, cursor: "pointer" }}>
                <input type="checkbox" checked={sortRecent} onChange={(e) => setSortRecent(e.target.checked)} /> Récents d&apos;abord
              </label>
            </div>
          )}
        </div>

        {error && (
          <div style={{ margin: "10px 16px 0", padding: "8px 12px", background: COLORS.errBg, color: COLORS.err, borderRadius: 8, fontSize: 12 }}>{error}</div>
        )}

        {/* Filtre local + compteur */}
        {results.length > 0 && (
          <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${COLORS.line}` }}>
            <div style={{ position: "relative", flex: "0 0 220px" }}>
              <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
              <input value={localFilter} onChange={(e) => setLocalFilter(e.target.value)} placeholder="Filtrer les résultats…" style={{ width: "100%", paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 12, outline: "none" }} />
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.ink3 }}>
              {visible.length} résultat{visible.length > 1 ? "s" : ""}
              {selectedIds.size > 0 ? ` · ${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}` : ""}
            </span>
            {selectedIds.size > 0 && (
              <button type="button" onClick={() => setSelectedIds(new Set())} style={ghostBtn(false)}>
                <X size={12} /> Désélectionner
              </button>
            )}
          </div>
        )}

        {/* Résultats */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {searching && results.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : !hasSearched ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
              Cherche des companies HubSpot, puis glisse-les sur un sales à droite pour les ajouter à la watchlist.
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>Aucun résultat.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {visible.map((c) => (
                <HubspotCompanyRow
                  key={c.hubspotId}
                  company={c}
                  scopeOwner={ownerOf(c.name)}
                  selected={selectedIds.has(c.hubspotId)}
                  dimmed={draggingIds.has(c.hubspotId)}
                  onSelect={handleSelect}
                  onDragStart={handleDragStart}
                  onDragEnd={() => setDraggingIds(new Set())}
                />
              ))}
              {nextAfter && (
                <button type="button" onClick={() => search(false)} disabled={loadingMore} style={{ ...ghostBtn(false), justifyContent: "center", margin: "8px auto 0" }}>
                  {loadingMore ? <Loader2 size={13} className="animate-spin" /> : "Charger plus"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rail sales (drop) */}
      <SalesRail
        reps={railReps}
        offRoster={[]}
        unassignedCount={0}
        activeFilter={ALL}
        dragActive={draggingIds.size > 0}
        mode="drop"
        showUnassigned={false}
        onFilter={() => {}}
        onAssign={assignDrop}
        onConfigure={() => setShowConfigure(true)}
      />

      {showConfigure && <ConfigureRepsDialog onClose={() => setShowConfigure(false)} onChanged={reloadRoster} />}
    </div>
  );
}

function inp(width: number): React.CSSProperties {
  return { width, padding: "6px 9px", fontSize: 12, borderRadius: 7, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, outline: "none" };
}

function ghostBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "7px 11px", fontSize: 12, fontWeight: 500,
    borderRadius: 8, border: `1px solid ${active ? COLORS.brand : COLORS.line}`, background: active ? COLORS.brandTintSoft : COLORS.bgCard,
    color: active ? COLORS.brand : COLORS.ink1, cursor: "pointer",
  };
}

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600,
    borderRadius: 8, border: "none", background: enabled ? COLORS.brand : COLORS.bgSoft, color: enabled ? "#fff" : COLORS.ink4, cursor: enabled ? "pointer" : "default",
  };
}
