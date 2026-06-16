"use client";

import { useState } from "react";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 - fast, economical" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 - balanced" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8 - most powerful" },
];

const FEATURES = [
  { key: "chat",           label: "Sales assistant (GPT)",              defaultModel: "claude-haiku-4-5-20251001" },
  { key: "briefing",       label: "Meeting briefing",                   defaultModel: "claude-haiku-4-5-20251001" },
  { key: "prospection",    label: "Prospecting email generation",       defaultModel: "claude-haiku-4-5-20251001" },
  { key: "mass_prospection", label: "Mass prospecting (campaigns)",     defaultModel: "claude-haiku-4-5-20251001" },
  { key: "deals_score",    label: "Deal scoring",                       defaultModel: "claude-haiku-4-5-20251001" },
  { key: "deals_analyze",  label: "In-depth deal analysis",             defaultModel: "claude-sonnet-4-6" },
  { key: "deals_email",    label: "Deal follow-up email",               defaultModel: "claude-haiku-4-5-20251001" },
  { key: "sales_coach",    label: "Sales Coach (meeting debriefs)",     defaultModel: "claude-haiku-4-5-20251001" },
  { key: "meeting_recap",  label: "Sales Coach - meeting recap",        defaultModel: "claude-haiku-4-5-20251001" },
  { key: "clients",        label: "Clients - profiles & recaps",        defaultModel: "claude-sonnet-4-6" },
  { key: "marketing",      label: "Marketing - articles & LinkedIn",    defaultModel: "claude-sonnet-4-6" },
  { key: "orgchart",       label: "Org Chart - hierarchy classification", defaultModel: "claude-sonnet-4-6" },
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
                <span className="text-xs" style={{ color: "#16a34a" }}>Saved</span>
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
