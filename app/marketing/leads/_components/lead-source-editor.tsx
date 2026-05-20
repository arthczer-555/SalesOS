"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { LEAD_SOURCE_CATEGORIES } from "@/lib/marketing-types";

interface Props {
  source: string | null;
  onChange: (next: string | null) => Promise<void>;
  disabled?: boolean;
}

export default function LeadSourceEditor({ source, onChange, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (value: string) => {
    setSaving(true);
    try {
      const next = value === "" ? null : value;
      await onChange(next);
      setEditing(false);
    } catch {
      // parent surfaces the error; keep edit mode open
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        title="Modifier l'origine"
        style={{
          background: "transparent",
          border: "1px dashed #d4d4d4",
          borderRadius: 4,
          padding: "1px 6px",
          fontSize: 12,
          color: source ? "#222" : "#888",
          cursor: disabled ? "not-allowed" : "pointer",
          fontStyle: source ? "normal" : "italic",
        }}
      >
        📣 {source ?? "Inconnu"}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {saving && <Loader2 size={12} className="animate-spin" />}
      <select
        autoFocus
        value={source ?? ""}
        disabled={saving}
        onChange={(e) => void handleSelect(e.target.value)}
        onBlur={() => !saving && setEditing(false)}
        style={{
          fontSize: 12,
          padding: "2px 6px",
          border: "1px solid #d4d4d4",
          borderRadius: 4,
          background: "#fff",
          color: "#222",
        }}
      >
        <option value="">Inconnu</option>
        {LEAD_SOURCE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </span>
  );
}
