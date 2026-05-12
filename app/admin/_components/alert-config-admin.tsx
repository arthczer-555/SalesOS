"use client";

import { useEffect, useState } from "react";

interface AlertConfig {
  enabled: boolean;
  slack_channel: string;
  min_score: number;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

export function AlertConfigAdmin({ initialConfig }: { initialConfig: AlertConfig }) {
  const [config, setConfig] = useState<AlertConfig>(initialConfig);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/slack-channels")
      .then(async (r) => {
        const data = (await r.json()) as { channels?: SlackChannel[]; error?: string };
        if (!r.ok || data.error) {
          setChannelsError(data.error ?? "Erreur Slack");
        } else {
          setChannels(data.channels ?? []);
        }
      })
      .catch((e) => setChannelsError(String(e)))
      .finally(() => setLoadingChannels(false));
  }, []);

  async function persist(next: AlertConfig) {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch("/api/admin/alert-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      }
    } finally {
      setSaving(false);
    }
  }

  function update(partial: Partial<AlertConfig>) {
    const next = { ...config, ...partial };
    setConfig(next);
    void persist(next);
  }

  const selectedChannel = channels.find((c) => c.id === config.slack_channel);

  return (
    <div className="space-y-4">
      {/* Toggle enabled */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium" style={{ color: "#111" }}>Activer les alertes Slack</p>
          <p className="text-[11px]" style={{ color: "#888" }}>
            Notification temps réel quand un signal LinkedIn passe le seuil de score.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => update({ enabled: !config.enabled })}
          disabled={saving}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
          style={{ background: config.enabled ? "#16a34a" : "#d4d4d4" }}
        >
          <span
            className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition"
            style={{ transform: config.enabled ? "translateX(16px)" : "translateX(0)" }}
          />
        </button>
      </div>

      {/* Channel picker */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium block" style={{ color: "#111" }}>
          Canal Slack
        </label>
        {loadingChannels && (
          <p className="text-[11px]" style={{ color: "#888" }}>Chargement des canaux…</p>
        )}
        {channelsError && (
          <p className="text-[11px]" style={{ color: "#dc2626" }}>
            {channelsError === "SLACK_BOT_TOKEN not set"
              ? "SLACK_BOT_TOKEN non configuré côté serveur."
              : `Erreur Slack : ${channelsError}`}
          </p>
        )}
        {!loadingChannels && !channelsError && (
          <>
            <select
              value={config.slack_channel}
              onChange={(e) => update({ slack_channel: e.target.value })}
              disabled={saving || !config.enabled}
              className="text-xs rounded-lg border px-2 py-1.5 outline-none w-full max-w-md"
              style={{ borderColor: "#e5e5e5", background: "#fafafa", color: "#111" }}
            >
              <option value="">— Aucun canal sélectionné —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.is_private ? "🔒 " : "#"}{c.name}
                </option>
              ))}
            </select>
            {selectedChannel && (
              <p className="text-[11px]" style={{ color: "#888" }}>
                ID : <code>{selectedChannel.id}</code>
              </p>
            )}
            {!selectedChannel && config.enabled && (
              <p className="text-[11px]" style={{ color: "#d97706" }}>
                ⚠️ Aucun canal sélectionné — les alertes ne partiront pas.
              </p>
            )}
          </>
        )}
      </div>

      {/* Min score */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium block" style={{ color: "#111" }}>
          Score minimum pour notifier — <span style={{ color: "#666" }}>{config.min_score}/100</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={config.min_score}
          onChange={(e) => setConfig({ ...config, min_score: Number(e.target.value) })}
          onMouseUp={(e) => update({ min_score: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => update({ min_score: Number((e.target as HTMLInputElement).value) })}
          disabled={saving || !config.enabled}
          className="w-full max-w-md"
        />
        <p className="text-[11px]" style={{ color: "#888" }}>
          Recommandé : 70. En dessous → bruit. Au dessus de 85 → tu rates des signaux moyens-forts.
        </p>
      </div>

      {/* Save indicator */}
      <div className="h-4">
        {saving && <span className="text-xs" style={{ color: "#888" }}>Enregistrement…</span>}
        {saved && <span className="text-xs" style={{ color: "#16a34a" }}>✓ Enregistré</span>}
      </div>
    </div>
  );
}
