"use client";

import React, { useState, useRef } from "react";
import { Search, Loader2, Linkedin, Building2, MapPin, X } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────
interface Profile {
  name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  current_company?: { name?: string; title?: string } | string;
  current_company_name?: string;
  city?: string;
  location?: string;
  about?: string;
  url?: string;
  input_url?: string;
  avatar?: string;
  [key: string]: unknown;
}

const BRAND = "#f01563";
const POLL_INTERVAL = 4000; // 4s
const MAX_POLLS = 60; // ~4 min

function companyName(p: Profile): string {
  if (typeof p.current_company === "string") return p.current_company;
  if (p.current_company?.name) return p.current_company.name;
  return p.current_company_name ?? "";
}

export default function ScrapeTestPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const cancelRef = useRef(false);

  function reset() {
    setError("");
    setProfiles(null);
    setStatusMsg("");
  }

  async function poll(snapshotId: string): Promise<Profile[]> {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (cancelRef.current) throw new Error("Annulé");
      setStatusMsg(`Scraping en cours… (${i * (POLL_INTERVAL / 1000)}s)`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      const res = await fetch(`/api/brightdata/scrape?snapshot_id=${encodeURIComponent(snapshotId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (json.ready) return (json.profiles as Profile[]) ?? [];
    }
    throw new Error("Délai dépassé : le scrape prend trop de temps");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || loading) return;
    reset();
    setLoading(true);
    cancelRef.current = false;
    try {
      setStatusMsg("Déclenchement du scrape…");
      const res = await fetch("/api/brightdata/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          company: company.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);

      let results = await poll(json.snapshotId);

      // Company optionnelle : on filtre / priorise côté client si renseignée.
      const c = company.trim().toLowerCase();
      if (c && results.length > 1) {
        const matched = results.filter((p) => companyName(p).toLowerCase().includes(c));
        if (matched.length) results = matched;
      }
      setProfiles(results);
      setStatusMsg("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setStatusMsg("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Bright Data · Scrape test</h1>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>
        Recherche un profil LinkedIn par nom (discover by name). La société est optionnelle et sert à filtrer les résultats.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="Prénom *"
          style={inputStyle}
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Nom *"
          style={inputStyle}
        />
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Société (optionnel)"
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={loading || !firstName.trim() || !lastName.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 20px",
            height: 42,
            borderRadius: 8,
            border: "none",
            background: loading || !firstName.trim() || !lastName.trim() ? "#f3a8c4" : BRAND,
            color: "white",
            fontWeight: 600,
            fontSize: 14,
            cursor: loading || !firstName.trim() || !lastName.trim() ? "not-allowed" : "pointer",
          }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? "Recherche…" : "Scraper"}
        </button>
      </form>

      {loading && statusMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6b7280", fontSize: 14, marginBottom: 16 }}>
          <Loader2 size={14} className="animate-spin" />
          {statusMsg}
          <button
            onClick={() => { cancelRef.current = true; }}
            style={{ marginLeft: 8, color: BRAND, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
          >
            <X size={13} style={{ display: "inline", verticalAlign: "middle" }} /> Annuler
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", borderRadius: 8, fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {profiles && profiles.length === 0 && (
        <div style={{ color: "#6b7280", fontSize: 14 }}>Aucun profil trouvé.</div>
      )}

      {profiles && profiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {profiles.map((p, i) => {
            const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Profil";
            const co = companyName(p);
            const loc = p.city || p.location || "";
            return (
              <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, display: "flex", gap: 14 }}>
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar} alt={name} width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 600, color: "#9ca3af" }}>
                    {name.charAt(0)}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{name}</div>
                  {p.position && <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>{p.position}</div>}
                  <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
                    {co && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Building2 size={12} /> {co}</span>}
                    {loc && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={12} /> {loc}</span>}
                  </div>
                  {(p.url || p.input_url) && (
                    <a
                      href={p.url || p.input_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 13, color: BRAND, textDecoration: "none" }}
                    >
                      <Linkedin size={13} /> Voir le profil
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "#6b7280" }}>Données brutes (JSON)</summary>
          <pre style={{ background: "#f9fafb", padding: 12, borderRadius: 8, fontSize: 11, overflow: "auto", marginTop: 8 }}>
            {JSON.stringify(profiles, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: "1 1 180px",
  minWidth: 140,
  height: 42,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
  outline: "none",
};
