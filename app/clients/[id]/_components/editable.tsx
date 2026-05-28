"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

// Éditeurs inline self-contained pour les blocs IA (recap deal, brief coachs,
// phrase health). Chacun gère son propre toggle d'édition et appelle
// onSave(newValue) — il ne connaît pas l'endpoint, c'est le panel parent qui
// branche le PATCH /content avec le bloc complet mis à jour.

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 8px",
  borderRadius: 6,
  border: `1px solid ${COLORS.brand}`,
  outline: "none",
  background: "white",
  color: COLORS.ink0,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  border: `1px solid ${COLORS.brand}`,
  background: COLORS.brand,
  color: "white",
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  border: `1px solid ${COLORS.line}`,
  background: "white",
  color: COLORS.ink2,
  cursor: "pointer",
};

function EmptyVal() {
  return <span style={{ color: COLORS.ink4, fontStyle: "italic", fontSize: 13 }}>Not set</span>;
}

function PencilBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Edit"
      style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: COLORS.ink4, flexShrink: 0 }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = COLORS.brand;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = COLORS.ink4;
      }}
    >
      <Pencil size={11} />
    </button>
  );
}

function Actions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <button type="button" onClick={onSave} disabled={saving} style={{ ...btnPrimary, cursor: saving ? "not-allowed" : "pointer" }}>
        <Check size={11} /> Save
      </button>
      <button type="button" onClick={onCancel} disabled={saving} style={{ ...btnGhost, cursor: saving ? "not-allowed" : "pointer" }}>
        <X size={11} /> Cancel
      </button>
    </div>
  );
}

// ── EditableText ──────────────────────────────────────────────────────────
export function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
}: {
  value: string | null | undefined;
  onSave: (v: string | null) => Promise<void>;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      await onSave(val.trim() || null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div>
        {multiline ? (
          <textarea
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            disabled={saving}
            rows={3}
            placeholder={placeholder}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          />
        ) : (
          <input
            autoFocus
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            disabled={saving}
            placeholder={placeholder}
            style={inputStyle}
          />
        )}
        <Actions saving={saving} onSave={commit} onCancel={() => { setEditing(false); setVal(value ?? ""); setError(null); }} />
        {error && <div style={{ fontSize: 11, color: COLORS.err, marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <div style={{ flex: 1, fontSize: 13, color: COLORS.ink0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {value && value.trim() ? value : <EmptyVal />}
      </div>
      <PencilBtn onClick={() => { setVal(value ?? ""); setEditing(true); }} />
    </div>
  );
}

// ── EditableStringList ────────────────────────────────────────────────────
export function EditableStringList({
  items,
  onSave,
  emptyLabel = "None",
}: {
  items: string[] | null | undefined;
  onSave: (v: string[] | null) => Promise<void>;
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((items ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      const arr = text.split("\n").map((s) => s.trim()).filter(Boolean);
      await onSave(arr.length ? arr : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
          rows={Math.max(3, (items?.length ?? 0) + 1)}
          placeholder="One item per line"
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
        <Actions saving={saving} onSave={commit} onCancel={() => { setEditing(false); setText((items ?? []).join("\n")); setError(null); }} />
        {error && <div style={{ fontSize: 11, color: COLORS.err, marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <div style={{ flex: 1 }}>
        {items && items.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {items.map((it, i) => (
              <li key={i} style={{ fontSize: 13, color: COLORS.ink0, display: "flex", gap: 8, lineHeight: 1.5 }}>
                <span style={{ color: COLORS.ink4 }}>•</span>
                {it}
              </li>
            ))}
          </ul>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.ink4, fontStyle: "italic" }}>{emptyLabel}</span>
        )}
      </div>
      <PencilBtn onClick={() => { setText((items ?? []).join("\n")); setEditing(true); }} />
    </div>
  );
}

// ── EditableObjectList ────────────────────────────────────────────────────
export type ObjectFieldSchema = { key: string; label: string; multiline?: boolean };

export function EditableObjectList({
  items,
  schema,
  onSave,
  emptyLabel = "None",
}: {
  items: Array<Record<string, unknown>> | null | undefined;
  schema: ObjectFieldSchema[];
  onSave: (v: Array<Record<string, string | null>> | null) => Promise<void>;
  emptyLabel?: string;
}) {
  const blank = () => Object.fromEntries(schema.map((f) => [f.key, ""])) as Record<string, string>;
  const toRows = () =>
    (items ?? []).map((o) => {
      const r = blank();
      for (const f of schema) r[f.key] = o[f.key] == null ? "" : String(o[f.key]);
      return r;
    });

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Array<Record<string, string>>>(toRows());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredKey = schema[0].key;

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = rows
        .map((row) => {
          const required = (row[requiredKey] ?? "").trim();
          if (!required) return null;
          const out: Record<string, string | null> = {};
          for (const f of schema) {
            const v = (row[f.key] ?? "").trim();
            out[f.key] = f.key === requiredKey ? required : v || null;
          }
          return out;
        })
        .filter((r): r is Record<string, string | null> => r !== null);
      await onSave(cleaned.length ? cleaned : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const setCell = (i: number, key: string, value: string) =>
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", borderLeft: `2px solid ${COLORS.line}`, paddingLeft: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              {schema.map((f) =>
                f.multiline ? (
                  <textarea
                    key={f.key}
                    value={row[f.key] ?? ""}
                    onChange={(e) => setCell(i, f.key, e.target.value)}
                    disabled={saving}
                    rows={2}
                    placeholder={f.label}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                ) : (
                  <input
                    key={f.key}
                    type="text"
                    value={row[f.key] ?? ""}
                    onChange={(e) => setCell(i, f.key, e.target.value)}
                    disabled={saving}
                    placeholder={f.label}
                    style={inputStyle}
                  />
                ),
              )}
            </div>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                disabled={saving}
                title="Remove"
                style={{ ...btnGhost, padding: "4px 6px" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} disabled={saving} style={{ ...btnGhost, width: "fit-content" }}>
          + Add
        </button>
        <Actions saving={saving} onSave={commit} onCancel={() => { setEditing(false); setRows(toRows()); setError(null); }} />
        {error && <div style={{ fontSize: 11, color: COLORS.err, marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <div style={{ flex: 1 }}>
        {items && items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((o, i) => (
              <div key={i} style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5 }}>
                {schema.map((f, fi) => {
                  const v = o[f.key];
                  if (v == null || String(v).trim() === "") return null;
                  return (
                    <span key={f.key} style={{ color: fi === 0 ? COLORS.ink0 : COLORS.ink3 }}>
                      {fi > 0 ? " · " : ""}
                      {String(v)}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.ink4, fontStyle: "italic" }}>{emptyLabel}</span>
        )}
      </div>
      <PencilBtn onClick={() => { setRows(toRows()); setEditing(true); }} />
    </div>
  );
}
