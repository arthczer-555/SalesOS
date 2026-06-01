"use client";

import * as React from "react";
import { Search, Plus, Filter as FilterIcon, Cloud, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

type SalesRep = { id: string; name: string };

type HubspotOwner = { id: string; name: string; email: string };

type PreviewCompany = {
  hubspotId: string;
  name: string;
  industry: string | null;
  country: string | null;
  employees: number | null;
  domain: string | null;
  lifecyclestage: string | null;
  ownerId: string | null;
  createdAt: string | null;
  alreadyInScope: boolean;
};

const CREATED_RANGES: { value: string; label: string }[] = [
  { value: "", label: "Toutes dates" },
  { value: "7d", label: "7 derniers jours" },
  { value: "30d", label: "30 derniers jours" },
  { value: "90d", label: "90 derniers jours" },
  { value: "year", label: "12 derniers mois" },
];

const LIFECYCLES: { value: string; label: string }[] = [
  { value: "subscriber", label: "Subscriber" },
  { value: "lead", label: "Lead" },
  { value: "marketingqualifiedlead", label: "MQL" },
  { value: "salesqualifiedlead", label: "SQL" },
  { value: "opportunity", label: "Opportunity" },
  { value: "customer", label: "Customer" },
  { value: "evangelist", label: "Evangelist" },
  { value: "other", label: "Other" },
];

const COUNTRY_PRESETS = [
  "France",
  "Belgium",
  "Switzerland",
  "Germany",
  "United Kingdom",
  "United States",
  "Spain",
  "Italy",
  "Netherlands",
];

export function HubspotImportPanel({
  reps,
  onImported,
}: {
  reps: SalesRep[];
  onImported: () => Promise<void> | void;
}) {
  const [q, setQ] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [lifecycles, setLifecycles] = React.useState<Set<string>>(new Set());
  const [employeesMin, setEmployeesMin] = React.useState<string>("");
  const [employeesMax, setEmployeesMax] = React.useState<string>("");
  const [ownerId, setOwnerId] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [createdRange, setCreatedRange] = React.useState("");
  const [sortRecent, setSortRecent] = React.useState(false);

  const [owners, setOwners] = React.useState<HubspotOwner[]>([]);
  const [results, setResults] = React.useState<PreviewCompany[]>([]);
  const [selectedHsIds, setSelectedHsIds] = React.useState<Set<string>>(new Set());
  const [defaultOwner, setDefaultOwner] = React.useState<string>("");
  const [customOwner, setCustomOwner] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [nextAfter, setNextAfter] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"skip" | "update">("skip");

  const PAGE_SIZE = 50;

  React.useEffect(() => {
    fetch("/api/intel/enrich/hubspot-owners")
      .then((r) => r.json())
      .then((j) => setOwners(j.owners ?? []))
      .catch(() => setOwners([]));
  }, []);

  function toggleLifecycle(v: string) {
    setLifecycles((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function buildFilters(): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (q.trim()) filters.q = q.trim();
    if (industry.trim()) filters.industry = [industry.trim()];
    if (country.trim()) filters.country = [country.trim()];
    if (lifecycles.size > 0) filters.lifecyclestage = Array.from(lifecycles);
    if (employeesMin) filters.employeesMin = Number(employeesMin);
    if (employeesMax) filters.employeesMax = Number(employeesMax);
    if (ownerId) filters.ownerId = ownerId;
    if (domain.trim()) filters.domain = domain.trim();
    if (createdRange) filters.createdRange = createdRange;
    if (sortRecent) filters.sort = "created-desc";
    return filters;
  }

  async function runSearch() {
    setSearching(true);
    setError(null);
    setSuccess(null);
    setResults([]);
    setSelectedHsIds(new Set());
    setNextAfter(null);
    try {
      const filters = buildFilters();

      const res = await fetch("/api/intel/admin/scope-companies/hubspot-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, dryRun: true, pageSize: PAGE_SIZE }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erreur recherche");
      const preview = (j.preview ?? []) as PreviewCompany[];
      setResults(preview);
      setNextAfter(j.nextAfter ?? null);
      // Auto-select tout ce qui n'est pas déjà dans la scope
      setSelectedHsIds(new Set(preview.filter((p) => !p.alreadyInScope).map((p) => p.hubspotId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
    }
  }

  async function loadMore() {
    if (!nextAfter || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const filters = buildFilters();
      const res = await fetch("/api/intel/admin/scope-companies/hubspot-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, dryRun: true, pageSize: PAGE_SIZE, after: nextAfter }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erreur");
      const more = (j.preview ?? []) as PreviewCompany[];
      setResults((prev) => {
        const seen = new Set(prev.map((p) => p.hubspotId));
        return [...prev, ...more.filter((m) => !seen.has(m.hubspotId))];
      });
      // Auto-select les nouvelles companies pas encore dans la scope (cohérent avec la 1re page).
      setSelectedHsIds((prev) => {
        const next = new Set(prev);
        more.filter((m) => !m.alreadyInScope).forEach((m) => next.add(m.hubspotId));
        return next;
      });
      setNextAfter(j.nextAfter ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleSelectAll() {
    if (selectedHsIds.size === results.length) {
      setSelectedHsIds(new Set());
    } else {
      setSelectedHsIds(new Set(results.map((r) => r.hubspotId)));
    }
  }

  function toggleOne(id: string) {
    setSelectedHsIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runImport() {
    const trimmedOwner = (defaultOwner === "__custom__" ? customOwner : defaultOwner).trim();
    if (!trimmedOwner) {
      setError("Choisis un owner par défaut.");
      return;
    }
    if (selectedHsIds.size === 0) {
      setError("Sélectionne au moins une company.");
      return;
    }
    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const filters = buildFilters();

      const res = await fetch("/api/intel/admin/scope-companies/hubspot-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters,
          dryRun: false,
          selectedIds: Array.from(selectedHsIds),
          defaultOwner: trimmedOwner,
          mode,
          max: 500,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erreur import");
      const s = j.summary as {
        inserted: number;
        updated: number;
        skipped: number;
        errors: { name: string; reason: string }[];
        total: number;
      };
      const parts: string[] = [];
      if (s.inserted > 0) parts.push(`${s.inserted} ajoutée${s.inserted > 1 ? "s" : ""}`);
      if (s.updated > 0) parts.push(`${s.updated} mise${s.updated > 1 ? "s" : ""} à jour`);
      if (s.skipped > 0) parts.push(`${s.skipped} doublon${s.skipped > 1 ? "s" : ""} ignoré${s.skipped > 1 ? "s" : ""}`);
      if (s.errors.length > 0) parts.push(`${s.errors.length} erreur${s.errors.length > 1 ? "s" : ""}`);
      setSuccess(parts.join(" · ") || "Aucun changement.");
      setSelectedHsIds(new Set());
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Filtres */}
      <div
        style={{
          padding: 16,
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cloud size={14} style={{ color: COLORS.brand }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
            Filtres HubSpot
          </h3>
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            Cherche des companies HubSpot et ajoute-les à ta watchlist.
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Recherche libre (nom / domaine)">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ex: ACME, lvmh, ratio.tech…"
              style={inputStyle()}
            />
          </Field>

          <Field label="Domaine contient">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="ex: .fr, gmail.com"
              style={inputStyle()}
            />
          </Field>

          <Field label="Industry (exact)">
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="ex: COMPUTER_SOFTWARE"
              style={inputStyle()}
            />
          </Field>

          <Field label="Pays">
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="ex: France"
              list="hs-country-list"
              style={inputStyle()}
            />
            <datalist id="hs-country-list">
              {COUNTRY_PRESETS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>

          <Field label="Employés min">
            <input
              type="number"
              min={0}
              value={employeesMin}
              onChange={(e) => setEmployeesMin(e.target.value)}
              placeholder="ex: 50"
              style={inputStyle()}
            />
          </Field>

          <Field label="Employés max">
            <input
              type="number"
              min={0}
              value={employeesMax}
              onChange={(e) => setEmployeesMax(e.target.value)}
              placeholder="ex: 5000"
              style={inputStyle()}
            />
          </Field>

          <Field label="Owner HubSpot">
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={inputStyle()}>
              <option value="">Tous</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ajouté dans HubSpot">
            <select value={createdRange} onChange={(e) => setCreatedRange(e.target.value)} style={inputStyle()}>
              {CREATED_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tri">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink1, cursor: "pointer", padding: "6px 0" }}>
              <input
                type="checkbox"
                checked={sortRecent}
                onChange={(e) => setSortRecent(e.target.checked)}
              />
              Plus récemment ajoutées d&apos;abord
            </label>
          </Field>

          <Field label="Lifecycle stage (multi)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {LIFECYCLES.map((l) => {
                const on = lifecycles.has(l.value);
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => toggleLifecycle(l.value)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      borderRadius: 999,
                      border: `1px solid ${on ? COLORS.brand : COLORS.line}`,
                      background: on ? COLORS.brand : COLORS.bgCard,
                      color: on ? "white" : COLORS.ink2,
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            style={{
              ...primaryBtn(),
              opacity: searching ? 0.6 : 1,
              cursor: searching ? "wait" : "pointer",
            }}
          >
            <Search size={12} /> {searching ? "Recherche…" : "Rechercher dans HubSpot"}
          </button>
          {error && (
            <span style={{ fontSize: 11, color: COLORS.err }}>{error}</span>
          )}
          {success && (
            <span style={{ fontSize: 11, color: COLORS.ok, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Check size={12} /> {success}
            </span>
          )}
        </div>
      </div>

      {/* Résultats */}
      {results.length > 0 && (
        <div
          style={{
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Toolbar import */}
          <div
            style={{
              padding: 12,
              borderBottom: `1px solid ${COLORS.line}`,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 12, color: COLORS.ink1, fontWeight: 500 }}>
              {selectedHsIds.size} / {results.length} sélectionnée{results.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={toggleSelectAll}
              style={{ ...btnSecondary(), padding: "4px 8px" }}
            >
              {selectedHsIds.size === results.length ? "Tout désélectionner" : "Tout sélectionner"}
            </button>

            <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 11, color: COLORS.ink2 }}>Owner *</label>
              <select
                value={defaultOwner}
                onChange={(e) => {
                  const v = e.target.value;
                  setDefaultOwner(v);
                  if (v !== "__custom__") setCustomOwner("");
                }}
                style={{ ...inputStyle(), minWidth: 160 }}
              >
                <option value="">— Choisir —</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
                <option value="__custom__">+ Nouveau owner…</option>
              </select>
              {defaultOwner === "__custom__" && (
                <input
                  value={customOwner}
                  onChange={(e) => setCustomOwner(e.target.value)}
                  placeholder="Nom du owner"
                  style={{ ...inputStyle(), width: 140 }}
                />
              )}

              <select value={mode} onChange={(e) => setMode(e.target.value as "skip" | "update")} style={inputStyle()}>
                <option value="skip">Doublons : ignorer</option>
                <option value="update">Doublons : mettre à jour</option>
              </select>

              <button
                type="button"
                onClick={runImport}
                disabled={importing || selectedHsIds.size === 0}
                style={{
                  ...primaryBtn(),
                  opacity: importing || selectedHsIds.size === 0 ? 0.6 : 1,
                  cursor: importing ? "wait" : "pointer",
                }}
              >
                <Plus size={12} /> {importing ? "Import…" : `Ajouter ${selectedHsIds.size}`}
              </button>
            </div>
          </div>

          {/* Table résultats */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: COLORS.bgCard,
                  borderBottom: `1px solid ${COLORS.line}`,
                }}
              >
                <tr>
                  <th style={th(36)}>
                    <input
                      type="checkbox"
                      checked={results.length > 0 && selectedHsIds.size === results.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th style={th()}>Entreprise</th>
                  <th style={th(160)}>Industry</th>
                  <th style={th(120)}>Pays</th>
                  <th style={th(100)}>Employés</th>
                  <th style={th(140)}>Lifecycle</th>
                  <th style={th(140)}>Domaine</th>
                  <th style={th(120)}>Ajouté</th>
                  <th style={th(120)}></th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => {
                  const checked = selectedHsIds.has(p.hubspotId);
                  return (
                    <tr
                      key={p.hubspotId}
                      style={{
                        borderBottom: `1px solid ${COLORS.line}`,
                        background: checked ? COLORS.brandTintSoft : "transparent",
                      }}
                    >
                      <td style={{ ...td(), textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(p.hubspotId)}
                          disabled={p.alreadyInScope}
                          title={p.alreadyInScope ? "Déjà dans ta watchlist" : ""}
                        />
                      </td>
                      <td style={{ ...td(), fontWeight: 500, color: COLORS.ink0 }}>
                        {p.name}
                      </td>
                      <td style={{ ...td(), color: COLORS.ink2 }}>{p.industry ?? "—"}</td>
                      <td style={{ ...td(), color: COLORS.ink2 }}>{p.country ?? "—"}</td>
                      <td style={{ ...td(), color: COLORS.ink2 }}>{p.employees ?? "—"}</td>
                      <td style={{ ...td(), color: COLORS.ink2 }}>{p.lifecyclestage ?? "—"}</td>
                      <td style={{ ...td(), color: COLORS.ink2, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                        {p.domain ?? "—"}
                      </td>
                      <td style={{ ...td(), color: COLORS.ink2, fontSize: 11 }}>{fmtCreated(p.createdAt)}</td>
                      <td style={{ ...td(), textAlign: "right" }}>
                        {p.alreadyInScope && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: COLORS.bgSoft,
                              color: COLORS.ink3,
                              fontWeight: 500,
                            }}
                          >
                            Déjà ajoutée
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {nextAfter && (
              <div style={{ padding: 12, textAlign: "center", borderTop: `1px solid ${COLORS.line}` }}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ ...btnSecondary(), opacity: loadingMore ? 0.6 : 1, cursor: loadingMore ? "wait" : "pointer" }}
                >
                  {loadingMore ? "Chargement…" : "Charger plus"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {results.length === 0 && !searching && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: COLORS.ink3,
            fontSize: 13,
            border: `1px dashed ${COLORS.line}`,
            borderRadius: 10,
            background: COLORS.bgCard,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <FilterIcon size={24} style={{ color: COLORS.ink4 }} />
          Aucun résultat. Définis tes filtres et lance une recherche HubSpot.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: COLORS.ink2 }}>{label}</label>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "6px 8px",
    fontSize: 12,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    outline: "none",
  };
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

function primaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
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
  return { padding: "8px 12px", verticalAlign: "middle" };
}

function fmtCreated(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}
