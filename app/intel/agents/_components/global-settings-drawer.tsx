"use client";

import * as React from "react";
import { X, Save } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

interface TargetsResponse {
  companies: string[];
  roles: string[];
}

export function GlobalSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [companies, setCompanies] = React.useState("");
  const [roles, setRoles] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    fetch("/api/intel/admin/targets")
      .then((r) => r.json() as Promise<TargetsResponse>)
      .then((data) => {
        setCompanies((data.companies ?? []).join("\n"));
        setRoles((data.roles ?? []).join("\n"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/intel/admin/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: companies.split("\n"),
          roles: roles.split("\n"),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      setSuccess("Cibles mises à jour.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const compCount = companies.split("\n").filter((s) => s.trim()).length;
  const rolesCount = roles.split("\n").filter((s) => s.trim()).length;

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
          width: 600,
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
            Cibles globales (ICP)
          </h2>
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            partagées par tous les agents
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: COLORS.ink3 }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {loading ? (
            <p style={{ color: COLORS.ink3 }}>Chargement…</p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>
                Ces deux listes alimentent : Company News, Hiring Spike, Funding & Expansion,
                Ads Activity, Init exhaustif, Weekly Scan. Une cible par ligne.
              </p>

              <Section title={`Sociétés ICP (${compCount})`}>
                <textarea
                  value={companies}
                  onChange={(e) => setCompanies(e.target.value)}
                  rows={14}
                  style={ta()}
                  placeholder="Une société par ligne&#10;ex: Danone&#10;Sanofi"
                />
              </Section>

              <Section title={`Titres / rôles ciblés (${rolesCount})`}>
                <textarea
                  value={roles}
                  onChange={(e) => setRoles(e.target.value)}
                  rows={10}
                  style={ta()}
                  placeholder="Un titre par ligne&#10;ex: DRH&#10;Head of L&D"
                />
              </Section>
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
          }}
        >
          {error && <span style={{ color: COLORS.err, fontSize: 12 }}>{error}</span>}
          {success && <span style={{ color: COLORS.ok, fontSize: 12 }}>{success}</span>}
          <button type="button" onClick={onClose} style={btnSecondary()}>
            Fermer
          </button>
          <button type="button" onClick={save} disabled={saving} style={btnPrimary()}>
            <Save size={13} />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
          margin: 0,
          marginBottom: 6,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
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
    marginLeft: "auto",
    padding: "6px 12px",
    fontSize: 12,
    borderRadius: 8,
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
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
  };
}
