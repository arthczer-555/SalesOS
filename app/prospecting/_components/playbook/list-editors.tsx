"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COLORS } from "@/lib/design/tokens";
import type { SourcedText } from "@/lib/prospecting/types";

const rowBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  border: 0,
  borderRadius: 8,
  background: "transparent",
  color: COLORS.ink4,
  cursor: "pointer",
};

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ch-link" style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", textDecoration: "none", color: COLORS.brandDark }}>
      <Plus size={13} /> {label}
    </button>
  );
}

// Liste éditable de phrases (pains, value props, CTAs...).
export function StringListEditor({ value, onChange, placeholder, addLabel = "Add", multiline }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string; multiline?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {value.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          {multiline ? (
            <div style={{ flex: 1 }}>
              <Textarea value={v} minRows={2} maxRows={10} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} />
            </div>
          ) : (
            <Input size="sm" value={v} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} />
          )}
          <button type="button" style={rowBtn} aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <AddRow label={addLabel} onClick={() => onChange([...value, ""])} />
    </div>
  );
}

// Liste de faits sourcés (proof points, insights) : texte + source.
export function SourcedListEditor({ value, onChange, addLabel = "Add" }: { value: SourcedText[]; onChange: (v: SourcedText[]) => void; addLabel?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: 8, background: COLORS.bgSoft, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Input size="sm" value={v.text} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="The fact, as it can be said in an email" />
            <Input size="sm" value={v.source ?? ""} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))} placeholder="Source (Notion page, study, client case...)" />
          </div>
          <button type="button" style={rowBtn} aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <AddRow label={addLabel} onClick={() => onChange([...value, { text: "", source: "" }])} />
    </div>
  );
}

export function ObjectionsEditor({ value, onChange }: { value: { objection: string; answer: string }[]; onChange: (v: { objection: string; answer: string }[]) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: 8, background: COLORS.bgSoft, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Input size="sm" value={v.objection} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, objection: e.target.value } : x)))} placeholder='Objection, e.g. "We already use Gong"' />
            <Textarea size="sm" minRows={2} value={v.answer} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} placeholder="How to answer it" />
          </div>
          <button type="button" style={rowBtn} aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <AddRow label="Add objection" onClick={() => onChange([...value, { objection: "", answer: "" }])} />
    </div>
  );
}
