"use client";

import { useState } from "react";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku — rapide, économique" },
  { id: "claude-sonnet-4-6", label: "Sonnet — équilibré" },
  { id: "claude-opus-4-6", label: "Opus — le plus puissant" },
];

const FEATURES = [
  { key: "chat",           label: "Assistant commercial (GPT)",         defaultModel: "claude-haiku-4-5-20251001" },
  { key: "briefing",       label: "Briefing réunion",                   defaultModel: "claude-haiku-4-5-20251001" },
  { key: "prospection",    label: "Génération d'emails prospection",    defaultModel: "claude-haiku-4-5-20251001" },
  { key: "mass_prospection", label: "Mass prospection (campagnes)",     defaultModel: "claude-haiku-4-5-20251001" },
  { key: "deals_score",    label: "Scoring des deals",                  defaultModel: "claude-haiku-4-5-20251001" },
  { key: "deals_analyze",  label: "Analyse approfondie des deals",      defaultModel: "claude-sonnet-4-6" },
  { key: "deals_email",    label: "Email de suivi deal",                defaultModel: "claude-haiku-4-5-20251001" },
  { key: "competitive",    label: "Analyse concurrentielle",            defaultModel: "claude-haiku-4-5-20251001" },
  { key: "market",         label: "Scan & signaux marché",              defaultModel: "claude-haiku-4-5-20251001" },
];

export function ModelPreferencesAdmin({ initialPreferences }: { initialPreferences: Record<string, string> }) {
  const [prefs, setPrefs] = useState<Record<string, string>>(initialPreferences);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleChange(feature: string, model: string) {
    const next = { ...prefs, [feature]: model };
    setPrefs(next);
    setSaving(feature);
    setSaved(null);
    try {
      await fetch("/api/admin/model-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setSaved(feature);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      {FEATURES.map((feature) => {
        const current = prefs[feature.key] ?? feature.defaultModel;
        return (
          <div key={feature.key} className="flex items-center justify-between gap-4">
            <span className="text-xs" style={{ color: "#444" }}>{feature.label}</span>
            <div className="flex items-center gap-2">
              {saved === feature.key && (
                <span className="text-xs" style={{ color: "#16a34a" }}>Enregistré</span>
              )}
              <select
                value={current}
                onChange={(e) => handleChange(feature.key, e.target.value)}
                disabled={saving === feature.key}
                className="text-xs rounded-lg border px-2 py-1.5 outline-none"
                style={{ borderColor: "#e5e5e5", background: "#fafafa", color: "#111", minWidth: 220 }}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
