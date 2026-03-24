"use client";

import { useState } from "react";

export function GuideEditor({
  initialGuide,
  defaultGuide,
}: {
  initialGuide: string | null;
  defaultGuide: string;
}) {
  const [guide, setGuide] = useState(initialGuide ?? defaultGuide);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isCustom = initialGuide !== null;

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guide }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setGuide(defaultGuide);
    await fetch("/api/settings/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: null }),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCustom ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#dbeafe", color: "#1e40af" }}>
              Personnalisé
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#475569" }}>
              Par défaut
            </span>
          )}
        </div>
        {isCustom && (
          <button
            onClick={resetToDefault}
            className="text-[10px]"
            style={{ color: "#aaa" }}
          >
            Réinitialiser au défaut
          </button>
        )}
      </div>

      <textarea
        value={guide}
        onChange={(e) => setGuide(e.target.value)}
        rows={18}
        className="w-full text-xs px-3 py-2.5 border rounded-lg outline-none resize-y font-mono"
        style={{ borderColor: "#e5e5e5", color: "#111", lineHeight: "1.7" }}
        placeholder="Décris ici ton style de prospection, les personas cibles, les exemples de formulations..."
      />

      <button
        onClick={save}
        disabled={saving}
        className="text-xs px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        style={{ background: saved ? "#dcfce7" : "#f01563", color: saved ? "#166534" : "#fff" }}
      >
        {saving ? "Sauvegarde..." : saved ? "Sauvegardé !" : "Sauvegarder"}
      </button>
    </div>
  );
}
