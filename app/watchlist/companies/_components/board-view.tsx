"use client";

import * as React from "react";
import { Search, Download, Loader2, Trash2, X, CheckSquare } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useWatchSalesReps, useWatchAccounts } from "@/lib/hooks/use-watchlist";
import { CompanyCard } from "./company-card";
import { SalesRail, type RailRep } from "./sales-rail";
import { BoardStats } from "./board-stats";
import { UNASSIGNED_KEY, type ScopeCompany } from "./types";

const ALL = "__all__";

export function BoardView() {
  const { reps, isLoading: repsLoading, reload: reloadReps } = useWatchSalesReps();
  const { accounts, isLoading: accLoading, reload: reloadAccounts } = useWatchAccounts(null);

  const [filter, setFilter] = React.useState<string>(ALL); // ALL | UNASSIGNED_KEY | owner(lower)
  const [search, setSearch] = React.useState("");
  const [sector, setSector] = React.useState("");
  const [platform, setPlatform] = React.useState("");

  // Sélection multiple (retrait groupé).
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const anchorRef = React.useRef<string | null>(null);

  // Rafraîchit à l'ouverture du Board (après une attribution dans la Liste).
  React.useEffect(() => {
    void reloadAccounts();
    void reloadReps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const railReps: RailRep[] = React.useMemo(
    () =>
      reps
        .map((r) => ({ id: r.id, name: r.name, email: r.email, count: r.account_count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [reps],
  );

  const unassignedCount = React.useMemo(
    () => accounts.filter((a) => !(a.owner ?? "").trim()).length,
    [accounts],
  );

  const sectorOptions = React.useMemo(
    () => Array.from(new Set(accounts.map((a) => a.sector?.trim()).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b)),
    [accounts],
  );
  const platformOptions = React.useMemo(
    () => Array.from(new Set(accounts.map((a) => a.current_coaching_platform?.trim()).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b)),
    [accounts],
  );

  const q = search.trim().toLowerCase();
  const visible = React.useMemo(
    () =>
      accounts.filter((a) => {
        if (filter === UNASSIGNED_KEY) {
          if ((a.owner ?? "").trim()) return false;
        } else if (filter !== ALL) {
          if ((a.owner ?? "").trim().toLowerCase() !== filter) return false;
        }
        if (sector && (a.sector ?? "") !== sector) return false;
        if (platform && (a.current_coaching_platform ?? "") !== platform) return false;
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          (a.owner ?? "").toLowerCase().includes(q) ||
          (a.sector ?? "").toLowerCase().includes(q) ||
          (a.current_coaching_platform ?? "").toLowerCase().includes(q)
        );
      }),
    [accounts, filter, sector, platform, q],
  );

  const selectedRepName = filter !== ALL && filter !== UNASSIGNED_KEY ? railReps.find((r) => r.name.toLowerCase() === filter)?.name ?? filter : null;

  async function removeCompany(c: ScopeCompany) {
    if (!confirm(`Retirer ${c.name} de la watchlist ?`)) return;
    const r = await fetch(`/api/intel/admin/scope-companies/${c.id}`, { method: "DELETE" });
    if (r.ok) {
      setSelectedIds((prev) => {
        if (!prev.has(c.id)) return prev;
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
      await Promise.all([reloadAccounts(), reloadReps()]);
    }
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    // Shift-clic : sélectionne la plage depuis la dernière carte cochée.
    if (e.shiftKey && anchorRef.current) {
      const order = visible.map((c) => c.id);
      const a = order.indexOf(anchorRef.current);
      const b = order.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(order[i]);
          return next;
        });
        anchorRef.current = id;
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

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selectedIds.has(c.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const c of visible) next.delete(c.id);
      else for (const c of visible) next.add(c.id);
      return next;
    });
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Retirer ${ids.length} compan${ids.length > 1 ? "ies" : "y"} de la watchlist ?`)) return;
    const r = await fetch("/api/intel/admin/scope-companies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (r.ok) {
      setSelectedIds(new Set());
      anchorRef.current = null;
      await Promise.all([reloadAccounts(), reloadReps()]);
    }
  }

  function exportCsv() {
    const esc = (v: string | null | undefined) => {
      const s = v ?? "";
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "name,owner,sector,current_coaching_platform,notes";
    const body = visible.map((c) =>
      [esc(c.name), esc(c.owner), esc(c.sector), esc(c.current_coaching_platform), esc(c.notes)].join(","),
    );
    const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const loading = (repsLoading || accLoading) && accounts.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Rail filtre sales */}
      <SalesRail
        reps={railReps}
        offRoster={[]}
        unassignedCount={unassignedCount}
        activeFilter={filter}
        dragActive={false}
        mode="filter"
        showUnassigned={unassignedCount > 0}
        onFilter={setFilter}
        onAssign={() => {}}
        onConfigure={() => {}}
      />

      {/* Zone principale */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div
          style={{
            padding: "10px 16px",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ position: "relative", flex: "0 0 240px" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une company…"
              style={{ width: "100%", paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 12, outline: "none", background: COLORS.bgCard }}
            />
          </div>
          <select value={sector} onChange={(e) => setSector(e.target.value)} style={selectStyle(!!sector)}>
            <option value="">Tous secteurs</option>
            {sectorOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selectStyle(!!platform)}>
            <option value="">Toutes plateformes</option>
            {platformOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
            {selectedIds.size > 0 && (
              <>
                <span style={{ fontSize: 11, color: COLORS.ink2, fontWeight: 600 }}>
                  {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                </span>
                <button type="button" onClick={removeSelected} style={dangerBtn()}>
                  <Trash2 size={12} /> Retirer
                </button>
                <button type="button" onClick={() => { setSelectedIds(new Set()); anchorRef.current = null; }} style={ghostBtn()}>
                  <X size={12} /> Désélectionner
                </button>
                <span style={{ width: 1, height: 18, background: COLORS.line }} />
              </>
            )}
            {visible.length > 0 && (
              <button type="button" onClick={toggleSelectAll} style={ghostBtn()}>
                <CheckSquare size={12} /> {allVisibleSelected ? "Tout désél." : "Tout sél."}
              </button>
            )}
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{visible.length} affichée{visible.length > 1 ? "s" : ""}</span>
            <button type="button" onClick={exportCsv} disabled={visible.length === 0} style={ghostBtn()}>
              <Download size={12} /> CSV
            </button>
          </span>
        </div>

        {/* Grille */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
              {accounts.length === 0
                ? "Aucune company. Va dans l'onglet Liste pour en ajouter depuis HubSpot."
                : "Aucun résultat avec ces filtres."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, alignContent: "start" }}>
              {visible.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  mode="read"
                  selectable
                  selected={selectedIds.has(c.id)}
                  selectionActive={selectedIds.size > 0}
                  onToggleSelect={toggleSelect}
                  onRemove={removeCompany}
                />
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <BoardStats visible={visible} totalAll={accounts.length} salesCount={railReps.length} selectedRep={selectedRepName} />
      </div>
    </div>
  );
}

function selectStyle(active: boolean): React.CSSProperties {
  return {
    padding: "7px 10px",
    fontSize: 12,
    borderRadius: 8,
    border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
    background: active ? COLORS.brandTintSoft : COLORS.bgCard,
    color: active ? COLORS.brand : COLORS.ink2,
    cursor: "pointer",
    outline: "none",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 10px",
    fontSize: 12,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function dangerBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: `1px solid ${COLORS.err}`,
    background: COLORS.errBg,
    color: COLORS.err,
    cursor: "pointer",
  };
}
