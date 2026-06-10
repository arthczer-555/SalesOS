"use client";

import * as React from "react";
import { Loader2, Building2, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Overlay, Header } from "./configure-reps-dialog";

// Petite modale : crée une company dans HubSpot (name + domaine optionnel).
export function NewHubspotCompanyDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hubspot/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setDone({ id: data.company.id, name: data.company.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 420, maxWidth: "94vw", display: "flex", flexDirection: "column" }}>
        <Header title="New HubSpot company" onClose={onClose} />
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {done ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", padding: "12px 0" }}>
              <Check size={28} style={{ color: COLORS.ok }} />
              <div style={{ fontSize: 13, color: COLORS.ink1, textAlign: "center" }}>
                <strong>{done.name}</strong> created in HubSpot.
              </div>
              <button type="button" onClick={onClose} style={primary(false)}>Close</button>
            </div>
          ) : (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>Company name</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" style={input()} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>Domain (optional)</span>
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" style={input()} />
              </label>
              {error && <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, color: COLORS.err, background: COLORS.errBg }}>{error}</div>}
              <button type="button" onClick={save} disabled={!name.trim() || saving} style={primary(!name.trim() || saving)}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
                {saving ? "Creating…" : "Create in HubSpot"}
              </button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function input(): React.CSSProperties {
  return { width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgSoft, color: COLORS.ink0, outline: "none", boxSizing: "border-box" };
}
function primary(disabled: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: COLORS.brand, color: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
}
