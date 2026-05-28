"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientFieldSource, ClientFieldValue, FieldDefinition } from "@/lib/clients/types";

// ── Confidence dot ───────────────────────────────────────────────────────

function ConfidenceDot({ confidence, source }: { confidence: number; source: ClientFieldSource | null }) {
  let color: string = COLORS.err;
  let label = "Low";
  if (confidence >= 0.7) {
    color = COLORS.ok;
    label = "High";
  } else if (confidence >= 0.4) {
    color = COLORS.warn;
    label = "Medium";
  }
  const sourceLabel = renderSourceLabel(source);
  return (
    <span
      title={`${label} confidence (${Math.round(confidence * 100)}%) · Source: ${sourceLabel}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        color: COLORS.ink3,
        flexShrink: 0,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      <span>{Math.round(confidence * 100)}%</span>
    </span>
  );
}

function renderSourceLabel(source: ClientFieldSource | null): string {
  if (!source) return "—";
  if (source.kind === "manual") return `Manual edit${source.userEmail ? ` · ${source.userEmail}` : ""}`;
  if (source.kind === "inferred") return "Inferred";
  if (source.kind === "claap") return `Claap${source.recordingId ? ` · ${source.recordingId}` : ""}`;
  if (source.kind === "hubspot") {
    const entity = source.entity ?? "?";
    return `HubSpot · ${entity}${source.id ? ` · ${source.id}` : ""}`;
  }
  return "-";
}

function MissingValue() {
  return <span style={{ color: COLORS.ink4, fontStyle: "italic", fontSize: 13 }}>Not set</span>;
}

// ── Read-only rendering ──────────────────────────────────────────────────

function renderValue(value: unknown, definition: FieldDefinition): React.ReactNode {
  const kind = definition.kind;
  if (value === null || value === undefined) return <MissingValue />;
  if (Array.isArray(value) && value.length === 0) return <MissingValue />;
  if (typeof value === "string" && !value.trim()) return <MissingValue />;

  switch (kind) {
    case "text":
    case "long_text":
      return <span style={{ fontSize: 13, color: COLORS.ink0, whiteSpace: "pre-wrap" }}>{String(value)}</span>;
    case "number":
      return <span style={{ fontSize: 13, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{String(value)}</span>;
    case "date": {
      try {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) return <span style={{ fontSize: 13, color: COLORS.ink0 }}>{String(value)}</span>;
        return (
          <span style={{ fontSize: 13, color: COLORS.ink0 }}>
            {d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
          </span>
        );
      } catch {
        return <span style={{ fontSize: 13, color: COLORS.ink0 }}>{String(value)}</span>;
      }
    }
    case "enum":
      return (
        <span
          style={{
            display: "inline-flex",
            padding: "2px 8px",
            borderRadius: 999,
            background: COLORS.brandTint,
            color: COLORS.brand,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {definition.optionLabels?.[String(value)] ?? String(value)}
        </span>
      );
    case "array_string": {
      const arr = value as string[];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {arr.map((s, i) => (
            <span
              key={i}
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: COLORS.bgSoft,
                color: COLORS.ink1,
                fontSize: 12,
                border: `1px solid ${COLORS.line}`,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      );
    }
    case "array_contact": {
      const arr = value as Array<{ name: string; email?: string; role?: string }>;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {arr.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: COLORS.ink0 }}>
              {c.name}
              {c.role ? <span style={{ color: COLORS.ink3 }}> · {c.role}</span> : null}
              {c.email ? <span style={{ color: COLORS.ink3 }}> · {c.email}</span> : null}
            </div>
          ))}
        </div>
      );
    }
    case "contact": {
      const c = value as { name: string; email?: string; role?: string };
      return (
        <div style={{ fontSize: 13, color: COLORS.ink0 }}>
          {c.name}
          {c.role ? <span style={{ color: COLORS.ink3 }}> · {c.role}</span> : null}
          {c.email ? <span style={{ color: COLORS.ink3 }}> · {c.email}</span> : null}
        </div>
      );
    }
    case "array_doc": {
      const arr = value as Array<{ title: string; url?: string }>;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {arr.map((d, i) => (
            <div key={i} style={{ fontSize: 13, color: COLORS.ink0 }}>
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer" style={{ color: COLORS.brand }}>
                  {d.title}
                </a>
              ) : (
                d.title
              )}
            </div>
          ))}
        </div>
      );
    }
    case "bool_with_details": {
      const b = value as { enabled: boolean; details?: string };
      return (
        <div style={{ fontSize: 13, color: COLORS.ink0 }}>
          <span
            style={{
              display: "inline-block",
              padding: "1px 8px",
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 11,
              background: b.enabled ? COLORS.okBg : COLORS.bgSoft,
              color: b.enabled ? COLORS.ok : COLORS.ink3,
            }}
          >
            {b.enabled ? "Enabled" : "No"}
          </span>
          {b.details && <span style={{ marginLeft: 8, color: COLORS.ink1 }}>{b.details}</span>}
        </div>
      );
    }
    default:
      return <span style={{ fontSize: 13, color: COLORS.ink0 }}>{JSON.stringify(value)}</span>;
  }
}

// ── Edit input ───────────────────────────────────────────────────────────
// Tous les kinds sont éditables. Simples (text, long_text, number, date,
// array_string, enum, bool_with_details) via un input unique ; complexes
// (contact, array_contact, array_doc) via des sous-formulaires structurés
// (un objet = plusieurs inputs, les arrays = lignes ajoutables/supprimables).

const EDITABLE_KINDS = new Set<FieldDefinition["kind"]>([
  "text", "long_text", "number", "date", "array_string", "enum", "bool_with_details",
  "contact", "array_contact", "array_doc",
]);

// Schéma des sous-champs pour les kinds objet/liste-d'objets.
const OBJECT_FIELD_SCHEMA: Partial<Record<FieldDefinition["kind"], Array<{ key: string; label: string }>>> = {
  contact: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
  ],
  array_contact: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
  ],
  array_doc: [
    { key: "title", label: "Title" },
    { key: "url", label: "URL" },
  ],
};

// Nettoie un objet de sous-champs : trim, vide -> on garde name/title requis,
// les autres champs vides -> null. Renvoie null si le champ requis est vide.
function cleanObjectRow(
  row: Record<string, string>,
  schema: Array<{ key: string; label: string }>,
): Record<string, string | null> | null {
  const requiredKey = schema[0].key; // name ou title
  const required = (row[requiredKey] ?? "").trim();
  if (!required) return null;
  const out: Record<string, string | null> = {};
  for (const f of schema) {
    const v = (row[f.key] ?? "").trim();
    out[f.key] = f.key === requiredKey ? required : v || null;
  }
  return out;
}

function FieldEditor({
  definition,
  initial,
  onSave,
  onCancel,
}: {
  definition: FieldDefinition;
  initial: unknown;
  onSave: (value: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  // Cast unifié : on garde tout en string pendant l'édition et on convertit au save
  const initialString = (() => {
    if (initial === null || initial === undefined) return "";
    if (Array.isArray(initial)) return (initial as string[]).join("\n");
    if (typeof initial === "object") return JSON.stringify(initial);
    return String(initial);
  })();

  const [val, setVal] = useState<string>(initialString);
  const [enabled, setEnabled] = useState<boolean>(
    definition.kind === "bool_with_details" && initial && typeof initial === "object" && "enabled" in initial
      ? (initial as { enabled: boolean }).enabled
      : false,
  );
  const [details, setDetails] = useState<string>(
    definition.kind === "bool_with_details" && initial && typeof initial === "object" && "details" in initial
      ? String((initial as { details?: string }).details ?? "")
      : "",
  );

  // État pour les kinds objet (contact) et liste d'objets (array_contact/array_doc).
  const objectSchema = OBJECT_FIELD_SCHEMA[definition.kind];
  const [rows, setRows] = useState<Array<Record<string, string>>>(() => {
    if (!objectSchema) return [];
    const blank: Record<string, string> = {};
    for (const f of objectSchema) blank[f.key] = "";
    const toRow = (o: Record<string, unknown>) => {
      const r: Record<string, string> = { ...blank };
      for (const f of objectSchema) r[f.key] = o[f.key] == null ? "" : String(o[f.key]);
      return r;
    };
    if (definition.kind === "contact") {
      return [
        initial && typeof initial === "object" && !Array.isArray(initial)
          ? toRow(initial as Record<string, unknown>)
          : { ...blank },
      ];
    }
    const arr = Array.isArray(initial) ? (initial as Array<Record<string, unknown>>) : [];
    return arr.length ? arr.map(toRow) : [{ ...blank }];
  });

  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current && "select" in inputRef.current) {
      try {
        (inputRef.current as HTMLInputElement).select();
      } catch {
        // selecting fails on some input types — ignore
      }
    }
  }, []);

  async function commit() {
    setSaving(true);
    try {
      let parsed: unknown;
      const trimmed = val.trim();
      switch (definition.kind) {
        case "text":
        case "long_text":
          parsed = trimmed ? trimmed : null;
          break;
        case "number":
          parsed = trimmed ? Number(trimmed) : null;
          if (parsed !== null && Number.isNaN(parsed as number)) parsed = null;
          break;
        case "date":
          parsed = trimmed || null;
          break;
        case "array_string":
          parsed = trimmed
            ? trimmed.split("\n").map((s) => s.trim()).filter(Boolean)
            : null;
          break;
        case "enum":
          parsed = trimmed || null;
          break;
        case "bool_with_details":
          parsed = { enabled, details: details.trim() || undefined };
          break;
        case "contact":
          parsed = objectSchema ? cleanObjectRow(rows[0] ?? {}, objectSchema) : null;
          break;
        case "array_contact":
        case "array_doc": {
          const cleaned = objectSchema
            ? rows.map((r) => cleanObjectRow(r, objectSchema)).filter((r): r is Record<string, string | null> => r !== null)
            : [];
          parsed = cleaned.length ? cleaned : null;
          break;
        }
        default:
          parsed = trimmed || null;
      }
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    const isMultiline = definition.kind === "long_text" || definition.kind === "array_string";
    if (e.key === "Enter" && (!isMultiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

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

  function renderInput() {
    if (objectSchema) {
      const isList = definition.kind === "array_contact" || definition.kind === "array_doc";
      const blank: Record<string, string> = {};
      for (const f of objectSchema) blank[f.key] = "";
      const setCell = (i: number, key: string, value: string) =>
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
      const iconBtn: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 6,
        border: `1px solid ${COLORS.line}`,
        background: "white",
        color: COLORS.ink2,
        cursor: saving ? "not-allowed" : "pointer",
      };
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                {objectSchema.map((f) => (
                  <input
                    key={f.key}
                    type="text"
                    value={row[f.key] ?? ""}
                    onChange={(e) => setCell(i, f.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        onCancel();
                      }
                    }}
                    disabled={saving}
                    placeholder={f.label}
                    style={inputStyle}
                  />
                ))}
              </div>
              {isList && rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  disabled={saving}
                  title="Remove this row"
                  style={{ ...iconBtn, padding: "4px 6px", marginTop: 2 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {isList && (
            <button type="button" onClick={() => setRows((rs) => [...rs, { ...blank }])} disabled={saving} style={iconBtn}>
              + Add
            </button>
          )}
        </div>
      );
    }
    if (definition.kind === "long_text") {
      return (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          placeholder="Cmd/Ctrl+Enter to save, Esc to cancel"
        />
      );
    }
    if (definition.kind === "array_string") {
      return (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
          rows={Math.max(3, val.split("\n").length + 1)}
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          placeholder="One item per line (Cmd/Ctrl+Enter to save)"
        />
      );
    }
    if (definition.kind === "enum") {
      const options = definition.options ?? [];
      return (
        <select
          ref={(el) => {
            inputRef.current = el;
          }}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
          style={inputStyle}
        >
          <option value="">(empty)</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {definition.optionLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>
      );
    }
    if (definition.kind === "bool_with_details") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: COLORS.ink0 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={saving} />
            Enabled
          </label>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            onKeyDown={onKey}
            disabled={saving}
            placeholder="Details (optional)"
            style={inputStyle}
          />
        </div>
      );
    }
    return (
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type={definition.kind === "number" ? "number" : definition.kind === "date" ? "date" : "text"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={onKey}
        disabled={saving}
        style={inputStyle}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {renderInput()}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            border: `1px solid ${COLORS.brand}`,
            background: COLORS.brand,
            color: "white",
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          <Check size={11} /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: "white",
            color: COLORS.ink2,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          <X size={11} /> Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

export function FieldDisplay({
  definition,
  field,
  clientId,
  sectionKey,
  onUpdated,
}: {
  definition: FieldDefinition;
  field: ClientFieldValue | undefined;
  clientId?: string;
  sectionKey?: string;
  onUpdated?: () => void;
}) {
  const value = field?.value;
  const confidence = field?.confidence ?? 0;
  const source = field?.source ?? null;
  const hasValue = value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = !!clientId && !!sectionKey && EDITABLE_KINDS.has(definition.kind);

  async function save(newValue: unknown) {
    if (!clientId || !sectionKey) return;
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey, fieldKey: definition.key, value: newValue }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr auto",
        gap: 16,
        padding: "10px 0",
        borderBottom: `1px solid ${COLORS.line}`,
        alignItems: "flex-start",
      }}
      onDoubleClick={() => {
        if (canEdit && !editing) setEditing(true);
      }}
    >
      <div style={{ fontSize: 12, color: COLORS.ink2, fontWeight: 500, paddingTop: 2 }}>
        {definition.label}
      </div>
      <div style={{ minWidth: 0 }}>
        {editing ? (
          <FieldEditor
            definition={definition}
            initial={value}
            onSave={save}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
          />
        ) : (
          renderValue(value, definition)
        )}
        {error && (
          <div style={{ fontSize: 11, color: COLORS.err, marginTop: 4 }}>{error}</div>
        )}
      </div>
      <div style={{ paddingTop: 3, display: "flex", alignItems: "center", gap: 8 }}>
        {hasValue && !editing ? <ConfidenceDot confidence={confidence} source={source} /> : null}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit (or double-click the row)"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              cursor: "pointer",
              color: COLORS.ink4,
              opacity: 0.6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.color = COLORS.brand;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.6";
              e.currentTarget.style.color = COLORS.ink4;
            }}
          >
            <Pencil size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
