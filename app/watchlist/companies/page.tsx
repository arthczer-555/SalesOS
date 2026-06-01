"use client";

import * as React from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { Download, Trash2, Search, ChevronLeft, Cloud } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { HubspotImportPanel } from "./_components/hubspot-import-panel";

type ScopeCompany = {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
};

type SalesRep = { id: string; name: string };

type View = "list" | "hubspot";

export default function MesCompaniesPage() {
  const { mutate: swrMutate } = useSWRConfig();
  const [companies, setCompanies] = React.useState<ScopeCompany[]>([]);
  const [reps, setReps] = React.useState<SalesRep[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [filter, setFilter] = React.useState("");
  const [ownerFilter, setOwnerFilter] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [view, setView] = React.useState<View>("list");

  const invalidateWatchlist = React.useCallback(() => {
    swrMutate(
      (key) => typeof key === "string" && key.startsWith("/api/watchlist/"),
      undefined,
      { revalidate: true }
    );
  }, [swrMutate]);

  const reloadCompanies = React.useCallback(async () => {
    const r = await fetch("/api/intel/admin/scope-companies").then((x) => x.json());
    setCompanies(r.companies ?? []);
    setSelectedIds(new Set());
  }, []);

  const reloadReps = React.useCallback(async () => {
    const r = await fetch("/api/intel/admin/sales-reps").then((x) => x.json());
    setReps(r.reps ?? []);
  }, []);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([reloadCompanies(), reloadReps()])
      .catch((e) => setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" }))
      .finally(() => setLoading(false));
  }, [reloadCompanies, reloadReps]);

  async function patchCompany(id: string, patch: Partial<ScopeCompany>) {
    setFeedback(null);
    const r = await fetch(`/api/intel/admin/scope-companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) {
      setFeedback({ kind: "err", msg: j.error ?? "Erreur" });
      return;
    }
    setCompanies((cs) => cs.map((c) => (c.id === id ? (j.company as ScopeCompany) : c)));
    if (patch.owner !== undefined) {
      await reloadReps();
      invalidateWatchlist();
    } else if (patch.name !== undefined) {
      invalidateWatchlist();
    }
  }

  async function removeCompany(id: string, name: string) {
    if (!confirm(`Retirer ${name} de tes companies ?`)) return;
    setFeedback(null);
    const r = await fetch(`/api/intel/admin/scope-companies/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setFeedback({ kind: "err", msg: j.error ?? "Erreur suppression" });
      return;
    }
    setCompanies((cs) => cs.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    invalidateWatchlist();
  }

  async function bulkDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const names = companies.filter((c) => selectedIds.has(c.id)).map((c) => c.name);
    const preview = names.slice(0, 3).join(", ") + (names.length > 3 ? `, +${names.length - 3}` : "");
    if (!confirm(`Supprimer ${ids.length} compan${ids.length > 1 ? "ies" : "y"} (${preview}) ?`)) return;
    setBulkDeleting(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/intel/admin/scope-companies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Erreur suppression");
      setCompanies((cs) => cs.filter((c) => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
      setFeedback({
        kind: "ok",
        msg: `${ids.length} compan${ids.length > 1 ? "ies supprimées" : "y supprimée"}.`,
      });
      invalidateWatchlist();
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const escape = (v: string | null | undefined): string => {
      const s = v ?? "";
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = "name,owner,sector,current_coaching_platform,notes";
    const body = companies.map((c) =>
      [
        escape(c.name),
        escape(c.owner),
        escape(c.sector),
        escape(c.current_coaching_platform),
        escape(c.notes),
      ].join(",")
    );
    const csv = [header, ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mes-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const f = filter.trim().toLowerCase();
  const owners = React.useMemo(
    () =>
      Array.from(new Set(companies.map((c) => c.owner?.trim()).filter((s): s is string => Boolean(s)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [companies]
  );
  const filtered = companies.filter((c) => {
    if (ownerFilter && (c.owner ?? "") !== ownerFilter) return false;
    if (!f) return true;
    return (
      c.name.toLowerCase().includes(f) ||
      (c.owner ?? "").toLowerCase().includes(f) ||
      (c.sector ?? "").toLowerCase().includes(f) ||
      (c.current_coaching_platform ?? "").toLowerCase().includes(f)
    );
  });

  const sectorOptions = Array.from(
    new Set(companies.map((c) => c.sector?.trim()).filter((s): s is string => Boolean(s)))
  ).sort((a, b) => a.localeCompare(b));
  const platformOptions = Array.from(
    new Set(companies.map((c) => c.current_coaching_platform?.trim()).filter((s): s is string => Boolean(s)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bgPage,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 24px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href="/watchlist"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: COLORS.ink3,
            textDecoration: "none",
          }}
        >
          <ChevronLeft size={14} /> Watch List
        </Link>
        <div style={{ width: 1, height: 16, background: COLORS.line }} />
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>
            Comptes prioritaires
          </h1>
          <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
            {companies.length} compan{companies.length > 1 ? "ies" : "y"} suivie
            {companies.length > 1 ? "s" : ""} · sélectionnées depuis HubSpot.
          </p>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              gap: 2,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 8,
              padding: 2,
              background: COLORS.bgSoft,
            }}
          >
            <button type="button" onClick={() => setView("list")} style={tabBtn(view === "list")}>
              Liste
            </button>
            <button type="button" onClick={() => setView("hubspot")} style={tabBtn(view === "hubspot")}>
              <Cloud size={12} /> Choisir depuis HubSpot
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            margin: "10px 24px 0",
            padding: "8px 12px",
            background: feedback.kind === "ok" ? COLORS.okBg : COLORS.errBg,
            color: feedback.kind === "ok" ? COLORS.ok : COLORS.err,
            border: `1px solid ${feedback.kind === "ok" ? COLORS.ok + "33" : COLORS.err + "33"}`,
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {feedback.msg}
        </div>
      )}

      {view === "list" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Toolbar */}
          <div
            style={{
              padding: 12,
              background: COLORS.bgSoft,
              borderRadius: 10,
              border: `1px solid ${COLORS.line}`,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ position: "relative", flex: "0 0 240px" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer une company…"
                style={{
                  width: "100%",
                  paddingLeft: 30,
                  paddingRight: 10,
                  paddingTop: 7,
                  paddingBottom: 7,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  fontSize: 12,
                  outline: "none",
                  background: COLORS.bgCard,
                }}
              />
            </div>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              style={{
                padding: "7px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${ownerFilter ? COLORS.brand : COLORS.line}`,
                background: ownerFilter ? COLORS.brandTintSoft : COLORS.bgCard,
                color: ownerFilter ? COLORS.brand : COLORS.ink2,
                cursor: "pointer",
                outline: "none",
                fontWeight: 500,
              }}
            >
              <option value="">Tous les owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>

            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setView("hubspot")}
                style={{ ...btnSecondary(), borderColor: COLORS.brand, color: COLORS.brand }}
              >
                <Cloud size={12} /> Choisir depuis HubSpot
              </button>
              <button type="button" onClick={exportCsv} disabled={companies.length === 0} style={btnSecondary()}>
                <Download size={12} /> Exporter CSV
              </button>
            </span>
          </div>

          {selectedIds.size > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: COLORS.brandTintSoft,
                border: `1px solid ${COLORS.brand}`,
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 12, color: COLORS.ink1, fontWeight: 500 }}>
                {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                style={{ ...btnSecondary(), padding: "4px 8px" }}
              >
                Tout désélectionner
              </button>
              <button
                type="button"
                onClick={bulkDeleteSelected}
                disabled={bulkDeleting}
                style={{
                  ...btnSecondary(),
                  marginLeft: "auto",
                  color: COLORS.err,
                  borderColor: COLORS.err,
                }}
              >
                <Trash2 size={12} /> {bulkDeleting ? "Suppression…" : "Supprimer la sélection"}
              </button>
            </div>
          )}

          <datalist id="sales-reps-list">
            {reps.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
          <datalist id="sectors-list">
            {sectorOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <datalist id="coaching-platforms-list">
            {platformOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>

          {/* Table */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              background: COLORS.bgCard,
              overflow: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: COLORS.bgCard,
                  borderBottom: `1px solid ${COLORS.line}`,
                  zIndex: 1,
                }}
              >
                <tr>
                  <th style={th(36)}>
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner"
                      checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
                      ref={(el) => {
                        if (!el) return;
                        const some = filtered.some((c) => selectedIds.has(c.id));
                        const all = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
                        el.indeterminate = some && !all;
                      }}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (checked) filtered.forEach((c) => next.add(c.id));
                          else filtered.forEach((c) => next.delete(c.id));
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th style={th()}>Entreprise</th>
                  <th style={th(160)}>Owner</th>
                  <th style={th(180)}>Secteur</th>
                  <th style={th(200)}>Plateforme coaching</th>
                  <th style={th()}>Notes</th>
                  <th style={th(40)}></th>
                </tr>
              </thead>
              <tbody>
                {loading && companies.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
                      Chargement…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
                      {companies.length === 0
                        ? "Aucune company. Choisis-en depuis HubSpot."
                        : "Aucun résultat avec ces filtres."}
                    </td>
                  </tr>
                )}
                {filtered.map((c) => (
                  <CompanyRow
                    key={c.id}
                    company={c}
                    selected={selectedIds.has(c.id)}
                    onToggleSelected={toggleSelected}
                    onPatch={patchCompany}
                    onRemove={removeCompany}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <HubspotImportPanel
          reps={reps}
          onImported={async () => {
            await Promise.all([reloadCompanies(), reloadReps()]);
            invalidateWatchlist();
            setView("list");
          }}
        />
      )}
    </div>
  );
}

function CompanyRow({
  company,
  selected,
  onToggleSelected,
  onPatch,
  onRemove,
}: {
  company: ScopeCompany;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  onPatch: (id: string, patch: Partial<ScopeCompany>) => void;
  onRemove: (id: string, name: string) => void;
}) {
  return (
    <tr
      style={{
        borderBottom: `1px solid ${COLORS.line}`,
        background: selected ? COLORS.brandTintSoft : "transparent",
      }}
    >
      <td style={{ ...td(), textAlign: "center" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(company.id)}
          aria-label={`Sélectionner ${company.name}`}
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.name}
          onCommit={(v) => v !== company.name && onPatch(company.id, { name: v })}
          placeholder="Entreprise"
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.owner ?? ""}
          onCommit={(v) =>
            (v || null) !== (company.owner ?? null) && onPatch(company.id, { owner: v || null })
          }
          placeholder="—"
          list="sales-reps-list"
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.sector ?? ""}
          onCommit={(v) =>
            (v || null) !== (company.sector ?? null) && onPatch(company.id, { sector: v || null })
          }
          placeholder="—"
          list="sectors-list"
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.current_coaching_platform ?? ""}
          onCommit={(v) =>
            (v || null) !== (company.current_coaching_platform ?? null) &&
            onPatch(company.id, { current_coaching_platform: v || null })
          }
          placeholder="—"
          list="coaching-platforms-list"
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.notes ?? ""}
          onCommit={(v) =>
            (v || null) !== (company.notes ?? null) && onPatch(company.id, { notes: v || null })
          }
          placeholder="—"
        />
      </td>
      <td style={{ ...td(), textAlign: "right" }}>
        <button
          type="button"
          onClick={() => onRemove(company.id, company.name)}
          aria-label="Supprimer"
          style={{ border: "none", background: "transparent", color: COLORS.err, cursor: "pointer", padding: 0 }}
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

function InlineEditable({
  value,
  onCommit,
  placeholder,
  list,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  list?: string;
}) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      list={list}
      style={{
        width: "100%",
        padding: "4px 6px",
        fontSize: 12,
        border: "1px solid transparent",
        borderRadius: 4,
        outline: "none",
        background: "transparent",
        color: COLORS.ink1,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = COLORS.line)}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "transparent")}
    />
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? COLORS.brand : "transparent",
    color: active ? "white" : COLORS.ink2,
    fontWeight: 500,
  };
}

function th(width?: number): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.ink3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    ...(width ? { width } : {}),
  };
}

function td(): React.CSSProperties {
  return { padding: "4px 8px", verticalAlign: "middle" };
}

function btnSecondary(): React.CSSProperties {
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
