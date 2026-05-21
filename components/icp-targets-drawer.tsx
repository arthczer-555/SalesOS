"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import { X, Save, Plus, Trash2, Upload, Download } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

type ScopeCompany = {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
};

type SalesRep = { id: string; name: string };

type ImportSummary = {
  parsed: number;
  deduped: number;
  toInsert: number;
  toUpdate: number;
  skipped: number;
  errors: { line: number; reason: string }[];
};

export type IcpDrawerSection = "companies" | "roles";

export function IcpTargetsDrawer({
  open,
  onClose,
  sections,
  title,
}: {
  open: boolean;
  onClose: () => void;
  sections?: IcpDrawerSection[];
  title?: string;
}) {
  const showCompanies = !sections || sections.includes("companies");
  const showRoles = !sections || sections.includes("roles");
  const resolvedTitle =
    title ??
    (showCompanies && showRoles
      ? "Cibles globales (ICP)"
      : showCompanies
      ? "Cibles ICP"
      : "Jobs cibles");
  const { mutate: swrMutate } = useSWRConfig();
  const [companies, setCompanies] = React.useState<ScopeCompany[]>([]);
  const [reps, setReps] = React.useState<SalesRep[]>([]);
  const [roles, setRoles] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [savingRoles, setSavingRoles] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [filter, setFilter] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [importPreview, setImportPreview] = React.useState<{ csv: string; summary: ImportSummary } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const invalidateWatchlist = React.useCallback(() => {
    swrMutate(
      (key) => typeof key === "string" && key.startsWith("/api/watchlist/"),
      undefined,
      { revalidate: true }
    );
  }, [swrMutate]);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFeedback(null);
    const fetches: Promise<unknown>[] = [];
    if (showCompanies) {
      fetches.push(
        fetch("/api/intel/admin/scope-companies").then((r) => r.json()).then((cs) => setCompanies(cs.companies ?? [])),
        fetch("/api/intel/admin/sales-reps").then((r) => r.json()).then((rs) => setReps(rs.reps ?? []))
      );
    }
    if (showRoles) {
      fetches.push(
        fetch("/api/intel/admin/targets").then((r) => r.json()).then((ts) => setRoles((ts.roles ?? []).join("\n")))
      );
    }
    Promise.all(fetches)
      .catch((e) => setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" }))
      .finally(() => setLoading(false));
  }, [open, showCompanies, showRoles]);

  async function reloadCompanies() {
    const r = await fetch("/api/intel/admin/scope-companies").then((x) => x.json());
    setCompanies(r.companies ?? []);
  }

  async function reloadReps() {
    const r = await fetch("/api/intel/admin/sales-reps").then((x) => x.json());
    setReps(r.reps ?? []);
  }

  async function addCompany() {
    const name = prompt("Nom de l'entreprise");
    if (!name?.trim()) return;
    setFeedback(null);
    const r = await fetch("/api/intel/admin/scope-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (!r.ok) {
      setFeedback({ kind: "err", msg: j.error ?? "Erreur ajout" });
      return;
    }
    await reloadCompanies();
    invalidateWatchlist();
  }

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
    if (!confirm(`Retirer ${name} de tes entreprises suivies ?`)) return;
    setFeedback(null);
    const r = await fetch(`/api/intel/admin/scope-companies/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setFeedback({ kind: "err", msg: j.error ?? "Erreur suppression" });
      return;
    }
    setCompanies((cs) => cs.filter((c) => c.id !== id));
    invalidateWatchlist();
  }

  async function saveRoles() {
    setSavingRoles(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/intel/admin/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: roles.split("\n") }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      setFeedback({ kind: "ok", msg: "Rôles enregistrés." });
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSavingRoles(false);
    }
  }

  function exportCsv() {
    const escape = (v: string | null): string => {
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
    a.download = `scope-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const csv = String(reader.result ?? "");
      const r = await fetch("/api/intel/admin/scope-companies/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFeedback({ kind: "err", msg: j.error ?? "Erreur import" });
        return;
      }
      setImportPreview({ csv, summary: j.summary as ImportSummary });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function commitImport(mode: "skip" | "update") {
    if (!importPreview) return;
    setImporting(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/intel/admin/scope-companies/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: importPreview.csv, mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erreur import");
      const s = j.summary as ImportSummary;
      const parts: string[] = [];
      if (s.toInsert > 0) parts.push(`${s.toInsert} ajoutée${s.toInsert > 1 ? "s" : ""}`);
      if (s.toUpdate > 0) parts.push(`${s.toUpdate} mise${s.toUpdate > 1 ? "s" : ""} à jour`);
      if (s.skipped > 0) parts.push(`${s.skipped} doublon${s.skipped > 1 ? "s" : ""} ignoré${s.skipped > 1 ? "s" : ""}`);
      setFeedback({ kind: "ok", msg: parts.join(" · ") || "Aucun changement." });
      setImportPreview(null);
      await Promise.all([reloadCompanies(), reloadReps()]);
      invalidateWatchlist();
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const f = filter.trim().toLowerCase();
  const filtered = f
    ? companies.filter(
        (c) =>
          c.name.toLowerCase().includes(f) ||
          (c.owner ?? "").toLowerCase().includes(f) ||
          (c.sector ?? "").toLowerCase().includes(f) ||
          (c.current_coaching_platform ?? "").toLowerCase().includes(f)
      )
    : companies;
  const rolesCount = roles.split("\n").filter((s) => s.trim()).length;

  const sectorOptions = Array.from(
    new Set(companies.map((c) => c.sector?.trim()).filter((s): s is string => Boolean(s)))
  ).sort((a, b) => a.localeCompare(b));
  const platformOptions = Array.from(
    new Set(
      companies
        .map((c) => c.current_coaching_platform?.trim())
        .filter((s): s is string => Boolean(s))
    )
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: showCompanies ? 1120 : 560,
          maxWidth: "100%",
          background: COLORS.bgCard,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
            {resolvedTitle}
          </h2>
          {showCompanies && showRoles && (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>partagées par tous les agents</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: COLORS.ink3 }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {loading ? (
            <p style={{ color: COLORS.ink3 }}>Chargement…</p>
          ) : (
            <>
              {showCompanies && showRoles && (
                <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>
                  Ces listes alimentent : Company News, Hiring Spike, Funding & Expansion,
                  Ads Activity, Init exhaustif, Weekly Scan.
                </p>
              )}

              {showCompanies && (
              <section>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h3
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: COLORS.ink3,
                      margin: 0,
                    }}
                  >
                    Entreprises suivies ({companies.length})
                  </h3>
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filtrer…"
                    style={{
                      marginLeft: 12,
                      padding: "5px 8px",
                      fontSize: 12,
                      border: `1px solid ${COLORS.line}`,
                      borderRadius: 6,
                      outline: "none",
                      background: COLORS.bgCard,
                      width: 160,
                    }}
                  />
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button type="button" onClick={addCompany} style={btnSecondary()}>
                      <Plus size={12} /> Ajouter
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} style={btnSecondary()}>
                      <Upload size={12} /> Importer CSV
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={onPickFile}
                      style={{ display: "none" }}
                    />
                    <button type="button" onClick={exportCsv} disabled={companies.length === 0} style={btnSecondary()}>
                      <Download size={12} /> Exporter CSV
                    </button>
                  </div>
                </div>

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

                <div
                  style={{
                    border: `1px solid ${COLORS.line}`,
                    borderRadius: 8,
                    background: COLORS.bgCard,
                    maxHeight: 380,
                    overflowY: "auto",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        background: COLORS.bgSoft,
                        borderBottom: `1px solid ${COLORS.line}`,
                        zIndex: 1,
                      }}
                    >
                      <tr>
                        <th style={th()}>Entreprise</th>
                        <th style={th(140)}>Owner</th>
                        <th style={th(160)}>Secteur</th>
                        <th style={th(180)}>Plateforme coaching</th>
                        <th style={th()}>Notes</th>
                        <th style={th(40)}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: 24, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
                            {companies.length === 0 ? "Aucune entreprise. Ajoutes-en ou importe un CSV." : "Aucun résultat."}
                          </td>
                        </tr>
                      )}
                      {filtered.map((c) => (
                        <CompanyRow key={c.id} company={c} onPatch={patchCompany} onRemove={removeCompany} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 10, color: COLORS.ink3, margin: "6px 2px 0" }}>
                  Modification inline · Tab pour passer au champ suivant. Dédup case-insensitive sur le nom.
                </p>
              </section>
              )}

              {showRoles && (
              <section>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <h3
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: COLORS.ink3,
                      margin: 0,
                    }}
                  >
                    Titres / rôles ciblés ({rolesCount})
                  </h3>
                  <button
                    type="button"
                    onClick={saveRoles}
                    disabled={savingRoles}
                    style={{ ...btnSecondary(), marginLeft: "auto" }}
                  >
                    <Save size={12} /> {savingRoles ? "…" : "Enregistrer rôles"}
                  </button>
                </div>
                <textarea
                  value={roles}
                  onChange={(e) => setRoles(e.target.value)}
                  rows={10}
                  style={ta()}
                  placeholder="Un titre par ligne&#10;ex: DRH&#10;Head of L&D"
                />
              </section>
              )}
            </>
          )}
        </div>

        <footer
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 12,
            minHeight: 48,
          }}
        >
          {feedback && (
            <span style={{ color: feedback.kind === "ok" ? COLORS.ok : COLORS.err, fontSize: 12 }}>
              {feedback.msg}
            </span>
          )}
          <button type="button" onClick={onClose} style={{ ...btnSecondary(), marginLeft: "auto" }}>
            Fermer
          </button>
        </footer>
      </aside>

      {importPreview && (
        <ImportPreviewModal
          summary={importPreview.summary}
          importing={importing}
          onCancel={() => setImportPreview(null)}
          onConfirm={commitImport}
        />
      )}
    </div>
  );
}

function CompanyRow({
  company,
  onPatch,
  onRemove,
}: {
  company: ScopeCompany;
  onPatch: (id: string, patch: Partial<ScopeCompany>) => void;
  onRemove: (id: string, name: string) => void;
}) {
  return (
    <tr style={{ borderBottom: `1px solid ${COLORS.line}` }}>
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
          onCommit={(v) => (v || null) !== (company.owner ?? null) && onPatch(company.id, { owner: v || null })}
          placeholder="—"
          list="sales-reps-list"
        />
      </td>
      <td style={td()}>
        <InlineEditable
          value={company.sector ?? ""}
          onCommit={(v) => (v || null) !== (company.sector ?? null) && onPatch(company.id, { sector: v || null })}
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
          onCommit={(v) => (v || null) !== (company.notes ?? null) && onPatch(company.id, { notes: v || null })}
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

function ImportPreviewModal({
  summary,
  importing,
  onCancel,
  onConfirm,
}: {
  summary: ImportSummary;
  importing: boolean;
  onCancel: () => void;
  onConfirm: (mode: "skip" | "update") => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          background: COLORS.bgCard,
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>Aperçu import CSV</h3>
        <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12, color: COLORS.ink1, lineHeight: 1.6 }}>
          <li>{summary.parsed} ligne{summary.parsed > 1 ? "s" : ""} lue{summary.parsed > 1 ? "s" : ""}</li>
          <li>
            {summary.toInsert} nouvelle{summary.toInsert > 1 ? "s" : ""} entreprise{summary.toInsert > 1 ? "s" : ""}
          </li>
          <li>
            {summary.deduped - summary.toInsert} doublon{summary.deduped - summary.toInsert > 1 ? "s" : ""} avec l&apos;existant
          </li>
          {summary.errors.length > 0 && (
            <li style={{ color: COLORS.err }}>
              {summary.errors.length} erreur{summary.errors.length > 1 ? "s" : ""} (ligne {summary.errors.slice(0, 3).map((e) => e.line).join(", ")}…)
            </li>
          )}
        </ul>
        <p style={{ margin: 0, fontSize: 12, color: COLORS.ink2 }}>
          Pour les doublons (case-insensitive sur le nom), tu veux :
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={btnSecondary()}>
            Annuler
          </button>
          <button type="button" onClick={() => onConfirm("skip")} disabled={importing} style={btnSecondary()}>
            Ignorer les doublons
          </button>
          <button type="button" onClick={() => onConfirm("update")} disabled={importing} style={btnPrimary()}>
            Écraser owner/notes
          </button>
        </div>
      </div>
    </div>
  );
}

function th(width?: number): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "6px 10px",
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

function ta(): React.CSSProperties {
  return {
    width: "100%",
    fontSize: 12,
    fontFamily: "ui-monospace, monospace",
    padding: 10,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    outline: "none",
    resize: "vertical",
    background: COLORS.bgCard,
    color: COLORS.ink0,
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

function btnPrimary(): React.CSSProperties {
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
