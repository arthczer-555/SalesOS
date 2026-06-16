"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Download, Loader2, Trash2, X, CheckSquare, Check, ChevronRight } from "lucide-react";
import { COLORS, RADIUS, SHADOWS, repAccent } from "@/lib/design/tokens";
import { useWatchSalesReps, useWatchAccounts } from "@/lib/hooks/use-watchlist";
import { SalesRail, type RailRep } from "./sales-rail";
import { BoardStats } from "./board-stats";
import { UNASSIGNED_KEY, STATUS_STYLE, type ScopeCompany } from "./types";

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
    if (!confirm(`Remove ${c.name} from the watchlist?`)) return;
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
    if (!confirm(`Remove ${ids.length} compan${ids.length > 1 ? "ies" : "y"} from the watchlist?`)) return;
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
    const header = "name,owner,sector,current_coaching_platform,status,email_count,notes";
    const body = visible.map((c) =>
      [esc(c.name), esc(c.owner), esc(c.sector), esc(c.current_coaching_platform), esc(c.status), String(c.email_count), esc(c.notes)].join(","),
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
            padding: "11px 18px",
            display: "flex",
            gap: 9,
            alignItems: "center",
            flexWrap: "wrap",
            background: COLORS.bgCard,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ position: "relative", flex: "0 0 268px" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a company…"
              style={{ width: "100%", paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 12, outline: "none", background: COLORS.bgCard }}
            />
          </div>
          <select value={sector} onChange={(e) => setSector(e.target.value)} style={selectStyle(!!sector)}>
            <option value="">All sectors</option>
            {sectorOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selectStyle(!!platform)}>
            <option value="">All platforms</option>
            {platformOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
            {selectedIds.size > 0 && (
              <>
                <span style={{ fontSize: 11, color: COLORS.ink2, fontWeight: 600 }}>
                  {selectedIds.size} selected
                </span>
                <button type="button" onClick={removeSelected} style={dangerBtn()}>
                  <Trash2 size={12} /> Remove
                </button>
                <button type="button" onClick={() => { setSelectedIds(new Set()); anchorRef.current = null; }} style={ghostBtn()}>
                  <X size={12} /> Deselect
                </button>
                <span style={{ width: 1, height: 18, background: COLORS.line }} />
              </>
            )}
            {visible.length > 0 && (
              <button type="button" onClick={toggleSelectAll} style={ghostBtn()}>
                <CheckSquare size={12} /> {allVisibleSelected ? "Deselect all" : "Select all"}
              </button>
            )}
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{visible.length} shown</span>
            <button type="button" onClick={exportCsv} disabled={visible.length === 0} style={ghostBtn()}>
              <Download size={12} /> CSV
            </button>
          </span>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, background: COLORS.bgPage }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
              {accounts.length === 0
                ? "No companies. Go to the List tab to add some from HubSpot."
                : "No results with these filters."}
            </div>
          ) : (
            <div
              style={{
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.line}`,
                borderRadius: RADIUS.lg,
                boxShadow: SHADOWS.card,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 44 }}>
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        aria-pressed={allVisibleSelected}
                        title={allVisibleSelected ? "Deselect all" : "Select all"}
                        style={checkboxStyle(allVisibleSelected)}
                      >
                        {allVisibleSelected && <Check size={11} />}
                      </button>
                    </th>
                    <th style={thStyle}>Company</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Sector</th>
                    <th style={thStyle}>Platform</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Emails</th>
                    <th style={{ ...thStyle, width: 72 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <CompanyRow
                      key={c.id}
                      company={c}
                      selected={selectedIds.has(c.id)}
                      selectionActive={selectedIds.size > 0}
                      onToggleSelect={toggleSelect}
                      onRemove={removeCompany}
                    />
                  ))}
                </tbody>
              </table>
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

// ---- Table primitives ----
const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: COLORS.ink3,
  padding: "10px 14px",
  background: COLORS.bgSoft,
  borderBottom: `1px solid ${COLORS.line}`,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "9px 14px",
  borderBottom: `1px solid ${COLORS.line}`,
  fontSize: 13,
  color: COLORS.ink2,
  verticalAlign: "middle",
};

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 22,
  padding: "0 8px",
  borderRadius: 6,
  background: COLORS.bgSoft,
  color: COLORS.ink2,
  fontSize: 11.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

function checkboxStyle(active: boolean): React.CSSProperties {
  return {
    width: 16,
    height: 16,
    borderRadius: 5,
    border: `1.5px solid ${active ? COLORS.brand : COLORS.ink4}`,
    background: active ? COLORS.brand : COLORS.bgCard,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    verticalAlign: "middle",
  };
}

// Dense-table row. Reuses the board handlers verbatim (toggleSelect w/ shift-range,
// removeCompany) and navigates to the company detail on row click.
function CompanyRow({
  company,
  selected,
  selectionActive,
  onToggleSelect,
  onRemove,
}: {
  company: ScopeCompany;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onRemove: (company: ScopeCompany) => void;
}) {
  const router = useRouter();
  const [hover, setHover] = React.useState(false);
  const owner = company.owner?.trim() || null;
  const accent = owner ? repAccent(owner) : null;
  const sector = company.sector?.trim() || null;
  const platform = company.current_coaching_platform?.trim() || null;
  const showCheck = hover || selected || selectionActive;

  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/watchlist/${company.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/watchlist/${company.id}`);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        background: selected ? COLORS.brandTintSoft : hover ? "#fcfcfb" : "transparent",
        transition: "background .12s ease",
      }}
    >
      <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-pressed={selected}
          title={selected ? "Deselect" : "Select"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(company.id, e);
          }}
          style={{ ...checkboxStyle(selected), opacity: showCheck ? 1 : 0.55 }}
        >
          {selected && <Check size={11} />}
        </button>
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.ink0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {company.name}
          </span>
        </div>
      </td>
      <td style={tdStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              flexShrink: 0,
              background: accent ?? "transparent",
              border: accent ? "none" : `1px dashed ${COLORS.ink4}`,
              boxShadow: accent ? `0 0 0 3px ${accent}22` : "none",
            }}
          />
          <span
            style={{
              color: owner ? COLORS.ink2 : COLORS.ink4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {owner ?? "Unassigned"}
          </span>
        </span>
      </td>
      <td style={tdStyle}>
        {sector ? <span style={tagStyle}>{sector}</span> : <span style={{ color: COLORS.ink4 }}>—</span>}
      </td>
      <td style={{ ...tdStyle, color: platform ? COLORS.ink2 : COLORS.ink4 }}>{platform ?? "—"}</td>
      <td style={tdStyle}>
        <StatusCell company={company} />
      </td>
      <td style={{ ...tdStyle, textAlign: "right" }} className="num">
        {company.email_count > 0 ? (
          <span style={{ fontWeight: 600, color: COLORS.ink1, fontVariantNumeric: "tabular-nums" }}>{company.email_count}</span>
        ) : (
          <span style={{ color: COLORS.ink4 }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
        <button
          type="button"
          title="Remove from watchlist"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(company);
          }}
          style={{
            border: "none",
            background: "transparent",
            color: COLORS.ink4,
            cursor: "pointer",
            padding: 2,
            opacity: hover ? 1 : 0,
            transition: "opacity .12s ease",
            verticalAlign: "middle",
          }}
        >
          <Trash2 size={14} />
        </button>
        <span
          style={{ color: COLORS.ink4, display: "inline-flex", verticalAlign: "middle", marginLeft: 2, pointerEvents: "none" }}
        >
          <ChevronRight size={16} />
        </span>
      </td>
    </tr>
  );
}

// Status pill (auto-derived, read-only): To enrich / Enriched / Contacted (X).
function StatusCell({ company }: { company: ScopeCompany }) {
  const s = STATUS_STYLE[company.status] ?? STATUS_STYLE["To enrich"];
  // "Contacted (X)" : on annexe le nombre d'emails envoyés quand il y en a.
  const label =
    company.status === "Contacted" && company.email_count > 0
      ? `Contacted (${company.email_count})`
      : company.status;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />
      {label}
    </span>
  );
}
