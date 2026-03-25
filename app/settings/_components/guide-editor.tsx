"use client";

import { useState } from "react";

export function GuideEditor({
  initialGuide,
  defaultGuide,
  endpoint = "/api/settings/guide",
  title,
  description,
}: {
  initialGuide: string | null;
  defaultGuide: string;
  endpoint?: string;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState(initialGuide ?? defaultGuide);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isCustom, setIsCustom] = useState(initialGuide !== null);

  async function save() {
    setSaving(true);
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guide }),
      });
      setIsCustom(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setGuide(defaultGuide);
    setIsCustom(false);
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: null }),
    });
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: "#eeeeee", background: "#fff" }}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: "#111" }}>{title}</p>
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
          <p className="text-xs mt-0.5" style={{ color: "#888" }}>{description}</p>
        </div>
        <svg
          className="shrink-0 ml-4 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", color: "#aaa" }}
          width="16" height="16" viewBox="0 0 16 16" fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-5 pb-5 space-y-3 border-t" style={{ borderColor: "#f5f5f5" }}>
          <div className="flex items-center justify-end pt-3">
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
      )}
    </div>
  );
}
