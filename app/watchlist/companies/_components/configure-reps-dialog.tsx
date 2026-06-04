"use client";

import * as React from "react";
import { X, Plus, Loader2, UserPlus } from "lucide-react";
import { COLORS, RADIUS, repAccent } from "@/lib/design/tokens";

type ManageRep = {
  id: string;
  name: string;
  email: string | null;
  hubspot_owner_id: string | null;
  in_roster: boolean;
};

type SalesUser = { id: string; name: string; email: string | null; hubspot_owner_id: string | null };

export function ConfigureRepsDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reps, setReps] = React.useState<ManageRep[]>([]);
  const [users, setUsers] = React.useState<SalesUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");

  const reload = React.useCallback(async () => {
    const r = await fetch("/api/intel/admin/sales-reps?manage=1").then((x) => x.json());
    setReps(r.reps ?? []);
  }, []);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([
      reload(),
      fetch("/api/intel/admin/sales-reps?source=users")
        .then((x) => x.json())
        .then((j) => setUsers(j.users ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [reload]);

  async function addRep(payload: { name: string; email?: string | null; hubspot_owner_id?: string | null }) {
    if (!payload.name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/intel/admin/sales-reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erreur");
      await reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function patchRep(id: string, patch: Partial<ManageRep>) {
    setErr(null);
    // optimiste
    setReps((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const r = await fetch(`/api/intel/admin/sales-reps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Erreur");
      await reload();
    }
    onChanged();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 560, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <Header title="Configurer les sales" onClose={onClose} />

        {err && (
          <div style={{ margin: "10px 16px 0", padding: "8px 12px", background: COLORS.errBg, color: COLORS.err, borderRadius: 8, fontSize: 12 }}>
            {err}
          </div>
        )}

        {/* Ajouter un sales */}
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom du sales"
            style={inputStyle(170)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                addRep({ name: newName.trim(), email: newEmail.trim() || null });
                setNewName("");
                setNewEmail("");
              }
            }}
          />
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email (optionnel)"
            style={inputStyle(170)}
          />
          <button
            type="button"
            disabled={!newName.trim() || busy}
            onClick={() => {
              addRep({ name: newName.trim(), email: newEmail.trim() || null });
              setNewName("");
              setNewEmail("");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              background: newName.trim() ? COLORS.brand : COLORS.bgSoft,
              color: newName.trim() ? "#fff" : COLORS.ink4,
              cursor: newName.trim() ? "pointer" : "default",
            }}
          >
            <Plus size={13} /> Ajouter
          </button>

          {/* Seed depuis les utilisateurs SalesOS */}
          {users.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const u = users.find((x) => x.id === e.target.value);
                if (u) addRep({ name: u.name, email: u.email, hubspot_owner_id: u.hubspot_owner_id });
              }}
              style={{ ...inputStyle(210), marginLeft: "auto", cursor: "pointer" }}
            >
              <option value="">+ Depuis un utilisateur SalesOS…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : reps.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: COLORS.ink3 }}>
              <UserPlus size={20} style={{ color: COLORS.ink4, marginBottom: 6 }} />
              <div>Aucun sales. Ajoute-en ci-dessus.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {reps.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: RADIUS.md,
                    background: r.in_roster ? COLORS.bgCard : COLORS.bgSoft,
                    border: `1px solid ${COLORS.line}`,
                    opacity: r.in_roster ? 1 : 0.65,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: repAccent(r.name),
                      flexShrink: 0,
                    }}
                  />
                  <InlineInput value={r.name} onCommit={(v) => v && v !== r.name && patchRep(r.id, { name: v })} placeholder="Nom" width={160} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineInput
                      value={r.email ?? ""}
                      onCommit={(v) => (v || null) !== (r.email ?? null) && patchRep(r.id, { email: v || null })}
                      placeholder="email (optionnel)"
                      width={180}
                    />
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: COLORS.ink2, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={r.in_roster} onChange={(e) => patchRep(r.id, { in_roster: e.target.checked })} />
                    Affiché
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "10px 16px", borderTop: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, cursor: "pointer" }}
          >
            Fermer
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Petits composants partagés (overlay/modale) ──────────────────────────
export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.bgCard, borderRadius: RADIUS.lg, boxShadow: "0 10px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}

export function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}` }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.ink0, flex: 1 }}>{title}</h2>
      <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer", display: "inline-flex" }}>
        <X size={16} />
      </button>
    </div>
  );
}

function InlineInput({
  value,
  onCommit,
  placeholder,
  width,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  width: number;
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
      }}
      placeholder={placeholder}
      style={inputStyle(width)}
    />
  );
}

function inputStyle(width: number): React.CSSProperties {
  return {
    width,
    padding: "6px 9px",
    fontSize: 12,
    borderRadius: 7,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    outline: "none",
  };
}
