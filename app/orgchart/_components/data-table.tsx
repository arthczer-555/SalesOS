"use client";

import { useMemo, useState } from "react";
import { Trash2, Plus, Search } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import {
  LEVELS,
  DECISION_ROLES,
  RELATIONSHIP_STATUSES,
  type OrgPerson,
  type OrgPersonInput,
} from "@/lib/orgchart/types";
import { LEVEL_LABELS, DECISION_ROLE_LABELS, RELATIONSHIP_LABELS } from "../_helpers";

interface Props {
  people: OrgPerson[];
  onUpdate: (id: string, fields: OrgPersonInput) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onAddPerson: () => void;
}

const cellStyle: React.CSSProperties = {
  padding: "0",
  borderBottom: `1px solid ${COLORS.line}`,
  borderRight: `1px solid ${COLORS.line}`,
  fontSize: 12.5,
  color: COLORS.ink0,
  verticalAlign: "middle",
};

const thStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: COLORS.bgSoft,
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  color: COLORS.ink2,
  textAlign: "left",
  borderBottom: `1px solid ${COLORS.lineStrong}`,
  borderRight: `1px solid ${COLORS.line}`,
  whiteSpace: "nowrap",
  zIndex: 1,
};

const editInput: React.CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  padding: "7px 10px",
  fontSize: 12.5,
  color: COLORS.ink0,
};

// Cellule texte non contrôlée : commit au blur / Enter. Le parent force le
// resync via une `key` qui inclut la valeur (remount après update externe).
function EditableText({
  value,
  onCommit,
  type = "text",
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      style={editInput}
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function SelectCell({
  value,
  options,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      style={{ ...editInput, cursor: "pointer", appearance: "auto" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DataTable({ people, onUpdate, onDelete, onBulkDelete, onAddPerson }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.name, p.title, p.entity, p.department, p.owner, p.email]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [people, query]);

  const managerOptions = useMemo(
    () => [{ value: "", label: "—" }, ...people.map((p) => ({ value: p.id, label: p.name }))],
    [people],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const levelOpts = LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }));
  const roleOpts = DECISION_ROLES.map((r) => ({ value: r, label: DECISION_ROLE_LABELS[r] }));
  const relOpts = RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABELS[s] }));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: COLORS.bgPage }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.lineStrong}`,
            borderRadius: 8,
            flex: 1,
            maxWidth: 320,
          }}
        >
          <Search size={14} style={{ color: COLORS.ink3 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent" }}
          />
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => {
              onBulkDelete([...selected]);
              setSelected(new Set());
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              color: COLORS.err,
              background: COLORS.errBg,
              borderRadius: 8,
            }}
          >
            <Trash2 size={14} /> Delete {selected.size}
          </button>
        )}
        <button
          onClick={onAddPerson}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            background: COLORS.brand,
            borderRadius: 8,
          }}
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: COLORS.bgCard, borderRadius: 10 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 32, textAlign: "center" }}></th>
              <th style={{ ...thStyle, minWidth: 160 }}>Name</th>
              <th style={{ ...thStyle, minWidth: 180 }}>Title</th>
              <th style={{ ...thStyle, minWidth: 150 }}>Entity</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Department</th>
              <th style={{ ...thStyle, minWidth: 110 }}>Level</th>
              <th style={{ ...thStyle, minWidth: 130 }}>Decision role</th>
              <th style={{ ...thStyle, minWidth: 130 }}>Relationship</th>
              <th style={{ ...thStyle, minWidth: 150 }}>Reports to</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Owner</th>
              <th style={{ ...thStyle, minWidth: 180 }}>Email</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} style={{ background: selected.has(p.id) ? COLORS.brandTintSoft : COLORS.bgCard }}>
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`name-${p.id}-${p.name}`} value={p.name} onCommit={(v) => onUpdate(p.id, { name: v })} />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`title-${p.id}-${p.title}`} value={p.title ?? ""} onCommit={(v) => onUpdate(p.id, { title: v })} />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`ent-${p.id}-${p.entity}`} value={p.entity ?? ""} onCommit={(v) => onUpdate(p.id, { entity: v })} />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`dep-${p.id}-${p.department}`} value={p.department ?? ""} onCommit={(v) => onUpdate(p.id, { department: v })} />
                </td>
                <td style={cellStyle}>
                  <SelectCell value={p.level ?? "unknown"} options={levelOpts} onCommit={(v) => onUpdate(p.id, { level: v as OrgPerson["level"] })} />
                </td>
                <td style={cellStyle}>
                  <SelectCell value={p.decision_role ?? "unknown"} options={roleOpts} onCommit={(v) => onUpdate(p.id, { decision_role: v as OrgPerson["decision_role"] })} />
                </td>
                <td style={cellStyle}>
                  <SelectCell value={p.relationship_status ?? "unknown"} options={relOpts} onCommit={(v) => onUpdate(p.id, { relationship_status: v as OrgPerson["relationship_status"] })} />
                </td>
                <td style={cellStyle}>
                  <SelectCell
                    value={p.manager_id ?? ""}
                    options={managerOptions.filter((o) => o.value !== p.id)}
                    onCommit={(v) => onUpdate(p.id, { manager_id: v || null })}
                  />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`own-${p.id}-${p.owner}`} value={p.owner ?? ""} onCommit={(v) => onUpdate(p.id, { owner: v })} />
                </td>
                <td style={cellStyle}>
                  <EditableText key={`em-${p.id}-${p.email}`} value={p.email ?? ""} onCommit={(v) => onUpdate(p.id, { email: v })} />
                </td>
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  <button onClick={() => onDelete(p.id)} title="Delete" style={{ color: COLORS.ink3, padding: 4 }}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: 24, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
                  No people. Use “Add” to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
