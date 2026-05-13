"use client";

import * as React from "react";
import { Plus, Trash2, Sparkles, Save, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

interface CompetitorProfile {
  id: string;
  username: string;
  full_name: string | null;
  headline: string | null;
  competitor_name: string | null;
  role_type: string | null;
  last_checked_at: string | null;
}

interface DiscoveredProfile {
  username: string;
  fullName: string;
  headline: string;
  profileUrl: string;
}

export function CompetitorConfig() {
  const [companies, setCompanies] = React.useState<string[]>([]);
  const [companyInput, setCompanyInput] = React.useState("");
  const [profiles, setProfiles] = React.useState<CompetitorProfile[]>([]);
  const [discovered, setDiscovered] = React.useState<DiscoveredProfile[]>([]);
  const [discoveringFor, setDiscoveringFor] = React.useState<string | null>(null);
  const [discoveredFor, setDiscoveredFor] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, []);

  async function load() {
    const [c, p] = await Promise.all([
      fetch("/api/intel/admin/competitor-companies").then((r) => r.json()),
      fetch("/api/intel/admin/competitor-profiles").then((r) => r.json()),
    ]);
    setCompanies(c.companies ?? []);
    setProfiles(p.profiles ?? []);
  }

  async function saveCompanies(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/intel/admin/competitor-companies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: next }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      setCompanies(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  function addCompany() {
    const v = companyInput.trim();
    if (!v) return;
    if (companies.includes(v)) {
      setCompanyInput("");
      return;
    }
    void saveCompanies([...companies, v]);
    setCompanyInput("");
  }

  function removeCompany(c: string) {
    void saveCompanies(companies.filter((x) => x !== c));
  }

  async function discover(company: string) {
    setDiscoveringFor(company);
    setError(null);
    setDiscovered([]);
    setDiscoveredFor(null);
    try {
      const r = await fetch("/api/intel/admin/competitor-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setDiscovered(data.profiles ?? []);
      setDiscoveredFor(company);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setDiscoveringFor(null);
    }
  }

  async function addDiscovered(d: DiscoveredProfile, company: string) {
    if (!company) {
      setError("Entreprise concurrente manquante — relance la découverte.");
      return;
    }
    setError(null);
    try {
      const r = await fetch("/api/intel/admin/competitor-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: d.username,
          full_name: d.fullName,
          headline: d.headline,
          competitor_name: company,
          role_type: deriveRoleType(d.headline),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setSuccess(`${d.fullName} ajouté.`);
      setDiscovered((cur) => cur.filter((x) => x.username !== d.username));
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function removeProfile(id: string) {
    if (!confirm("Retirer ce profil ?")) return;
    await fetch(`/api/intel/admin/competitor-profiles?id=${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Entreprises concurrentes">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {companies.map((c) => (
            <span
              key={c}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 99,
                background: COLORS.brandTint,
                color: COLORS.brand,
              }}
            >
              {c}
              <button
                type="button"
                onClick={() => discover(c)}
                disabled={discoveringFor === c}
                aria-label="Auto-discover AE/AM"
                style={{ border: "none", background: "transparent", color: COLORS.brand, cursor: "pointer", padding: 0 }}
                title="Auto-discover AE/AM"
              >
                <Sparkles size={11} />
              </button>
              <button
                type="button"
                onClick={() => removeCompany(c)}
                aria-label={`Retirer ${c}`}
                style={{ border: "none", background: "transparent", color: COLORS.brand, cursor: "pointer", padding: 0 }}
              >
                <Trash2 size={10} />
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCompany();
              }
            }}
            placeholder="ex: CoachHub, BetterUp"
            style={inp()}
            disabled={saving}
          />
          <button type="button" onClick={addCompany} style={btn()} disabled={saving}>
            <Plus size={12} /> Ajouter
          </button>
        </div>
        <p style={{ fontSize: 11, color: COLORS.ink3, marginTop: 6 }}>
          Clique <Sparkles size={10} style={{ display: "inline", verticalAlign: "middle" }} /> pour découvrir les AE/AM/SDR/BDR via Netrows.
        </p>
      </Section>

      {discoveringFor && (
        <p style={{ fontSize: 12, color: COLORS.ink3 }}>Découverte en cours pour {discoveringFor}…</p>
      )}

      {discovered.length > 0 && (
        <Section title={`Profils découverts (${discovered.length}) — coche pour ajouter`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {discovered.map((d) => (
              <div
                key={d.username}
                style={{
                  padding: "8px 10px",
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 6,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.fullName}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.headline}
                  </div>
                </div>
                {d.profileUrl && (
                  <a href={d.profileUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.ink3 }}>
                    <ExternalLink size={11} />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => addDiscovered(d, discoveredFor ?? "")}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11,
                    borderRadius: 6,
                    border: `1px solid ${COLORS.brand}`,
                    background: COLORS.brand,
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Ajouter
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Profils trackés (${profiles.length})`}>
        {profiles.length === 0 ? (
          <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>
            Aucun profil. Ajoute des entreprises ci-dessus puis utilise l&apos;auto-discovery.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
            {profiles.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "6px 10px",
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 6,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.full_name ?? p.username}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.ink2 }}>
                    {p.competitor_name ?? "—"} {p.role_type ? `· ${p.role_type}` : ""}
                  </div>
                </div>
                <a
                  href={`https://www.linkedin.com/in/${p.username}/`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: COLORS.ink3 }}
                >
                  <ExternalLink size={11} />
                </a>
                <button
                  type="button"
                  onClick={() => removeProfile(p.id)}
                  aria-label="Retirer"
                  style={{ border: "none", background: "transparent", color: COLORS.err, cursor: "pointer" }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {error && <p style={{ color: COLORS.err, fontSize: 12, margin: 0 }}>{error}</p>}
      {success && <p style={{ color: COLORS.ok, fontSize: 12, margin: 0 }}>{success}</p>}
    </div>
  );
}

function deriveRoleType(headline: string | null): string {
  const h = (headline ?? "").toLowerCase();
  if (h.includes("account executive") || /\bae\b/.test(h)) return "AE";
  if (h.includes("account manager") || /\bam\b/.test(h)) return "AM";
  if (h.includes("bdr") || h.includes("business development")) return "BDR";
  if (h.includes("sdr") || h.includes("sales development")) return "SDR";
  return "Sales";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.ink3, margin: 0, marginBottom: 6 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function inp(): React.CSSProperties {
  return {
    flex: 1,
    padding: "6px 10px",
    fontSize: 12,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    outline: "none",
  };
}

function btn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

// Suppress unused import lint (keep the icon export for future use)
const _Save = Save;
void _Save;
