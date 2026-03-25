"use client";

import { useState, useMemo } from "react";

type UserStat = {
  id: string; name: string; calls: number;
  inputTokens: number; outputTokens: number; costUsd: number;
  lastSeen: string; features: string[];
};
type FeatureStat = {
  feature: string; label: string; calls: number;
  inputTokens: number; outputTokens: number; costUsd: number;
};
type RawLog = {
  id: string; user_id: string; userName: string; model: string;
  feature: string | null; featureLabel: string;
  input_tokens: number; output_tokens: number; costUsd: number; created_at: string;
};

const DATE_RANGES = [
  { label: "7j",    days: 7 },
  { label: "30j",   days: 30 },
  { label: "3 mois", days: 90 },
  { label: "Tout",  days: 0 },
];

function fmtCost(usd: number) {
  if (usd < 0.001) return "< $0.001";
  return `$${usd.toFixed(3)}`;
}
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function initials(name: string) {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function sinceLabel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  if (h < 1) return "il y a < 1h";
  if (h < 24) return `il y a ${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d}j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function filterByDays<T extends { created_at: string }>(items: T[], days: number): T[] {
  if (days === 0) return items;
  const cutoff = Date.now() - days * 86_400_000;
  return items.filter((i) => new Date(i.created_at).getTime() >= cutoff);
}

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  chat:                    "Onglet Coachello Intelligence — chaque message envoyé au bot",
  conversations:           "Onglet Coachello Intelligence — génération automatique du titre de conversation (1er message uniquement)",
  briefing:                "Onglet Briefing — synthèse pré-meeting (contexte HubSpot + calendrier)",
  market_scan:             "Onglet Market Intel — scan web d'une entreprise cible",
  market_signals:          "Onglet Market Intel — extraction de signaux commerciaux",
  market_context:          "Onglet Market Intel — analyse du contexte d'entreprise",
  market_contacts:         "Onglet Market Intel — recherche de contacts web",
  competitive:             "Onglet Competition — analyse d'un concurrent",
  competitive_chat:        "Onglet Competition — chat contextuel sur un concurrent",
  competitive_battlecard:  "Onglet Competition — génération de battlecard",
  competitive_report:      "Onglet Competition — rapport de veille concurrentielle",
  prospection_search:      "Onglet Prospection — recherche IA de prospects (langage naturel)",
  prospection_generate:    "Onglet Prospection — génération d'email de prospection",
  prospection_bulk:        "Onglet Prospection — génération d'emails en masse",
  prospection_details:     "Onglet Prospection — inférence des champs de contexte depuis HubSpot",
  deals_analyze:           "Onglet Deals — analyse d'opportunité",
  deals_email:             "Onglet Deals — génération d'email de relance deal",
  deals_score:             "Onglet Deals — scoring automatique d'un deal",
};

const MODEL_COLORS: Record<string, { bg: string; text: string }> = {
  "haiku-4-5":   { bg: "#f0fdf4", text: "#166534" },
  "sonnet-4-6":  { bg: "#eff6ff", text: "#1d4ed8" },
  "opus-4-6":    { bg: "#fdf4ff", text: "#7e22ce" },
};

function shortModel(model: string) {
  return model.replace("claude-", "").replace("-20251001", "");
}

// Re-aggregate byUser from raw logs given a date range
function reAggregate(rawLogs: RawLog[], days: number) {
  const filtered = filterByDays(rawLogs, days);
  const byUser = new Map<string, UserStat>();
  const byFeature = new Map<string, { feature: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  const byUserFeature: Record<string, Record<string, number>> = {};
  const featureModels: Record<string, Set<string>> = {};

  for (const log of filtered) {
    // user
    const cur = byUser.get(log.user_id) ?? { id: log.user_id, name: log.userName, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, lastSeen: log.created_at, features: [] as string[] };
    cur.calls++;
    cur.inputTokens += log.input_tokens;
    cur.outputTokens += log.output_tokens;
    cur.costUsd += log.costUsd;
    if (log.created_at > cur.lastSeen) cur.lastSeen = log.created_at;
    if (log.feature && !cur.features.includes(log.feature)) cur.features.push(log.feature);
    byUser.set(log.user_id, cur);

    // feature
    const fk = log.feature ?? "unknown";
    const fc = byFeature.get(fk) ?? { feature: fk, label: log.featureLabel, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    fc.calls++; fc.inputTokens += log.input_tokens; fc.outputTokens += log.output_tokens; fc.costUsd += log.costUsd;
    byFeature.set(fk, fc);

    // feature → models
    if (!featureModels[fk]) featureModels[fk] = new Set();
    featureModels[fk].add(shortModel(log.model));

    // user × feature
    if (!byUserFeature[log.user_id]) byUserFeature[log.user_id] = {};
    byUserFeature[log.user_id][fk] = (byUserFeature[log.user_id][fk] ?? 0) + 1;
  }

  // Serialise Sets
  const featureModelsArr: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(featureModels)) featureModelsArr[k] = Array.from(v);

  return {
    byUser: Array.from(byUser.values()).sort((a, b) => b.costUsd - a.costUsd),
    byFeature: Array.from(byFeature.values()).sort((a, b) => b.costUsd - a.costUsd),
    byUserFeature,
    filteredLogs: filtered,
    allFeatures: Array.from(byFeature.keys()),
    featureModels: featureModelsArr,
  };
}

export function UsageTabs({
  byUser: initialByUser,
  byFeature: initialByFeature,
  allFeatures: initialFeatures,
  byUserFeature: initialUxF,
  rawLogs,
  featureLabels,
}: {
  byUser: UserStat[];
  byFeature: FeatureStat[];
  allFeatures: string[];
  byUserFeature: Record<string, Record<string, number>>;
  rawLogs: RawLog[];
  featureLabels: Record<string, string>;
}) {
  const [tab, setTab] = useState<"users" | "features" | "grid" | "activity" | "catalog">("users");
  const [days, setDays] = useState(30);
  const [filterUser, setFilterUser] = useState("");
  const [filterFeature, setFilterFeature] = useState("");

  const { byUser, byFeature, byUserFeature, filteredLogs, allFeatures, featureModels } = useMemo(
    () => reAggregate(rawLogs, days),
    [rawLogs, days]
  );

  const TABS = [
    { id: "users",    label: "Par utilisateur" },
    { id: "features", label: "Par feature" },
    { id: "grid",     label: "User × Feature" },
    { id: "activity", label: "Activité" },
    { id: "catalog",  label: "Features & Modèles" },
  ] as const;

  return (
    <div>
      {/* Date filter */}
      <div className="flex items-center gap-2 mb-5">
        {DATE_RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setDays(r.days)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{
              background: days === r.days ? "#f01563" : "#f5f5f5",
              color: days === r.days ? "#fff" : "#555",
            }}
          >
            {r.label}
          </button>
        ))}
        <span className="text-xs ml-2" style={{ color: "#aaa" }}>
          {filteredLogs.length} appels
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "#eee" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="text-sm px-4 py-2.5 font-medium transition-colors"
            style={{
              color: tab === t.id ? "#f01563" : "#888",
              borderBottom: tab === t.id ? "2px solid #f01563" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: Par utilisateur ─────────────────────────────────────────── */}
      {tab === "users" && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#eee" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                {["Utilisateur", "Appels", "Tokens in", "Tokens out", "Coût total", "Dernière activité"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byUser.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: i < byUser.length - 1 ? "1px solid #f5f5f5" : undefined }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: "#f01563", color: "#fff" }}>
                        {initials(u.name)}
                      </div>
                      <span className="font-medium text-xs" style={{ color: "#111" }}>{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: "#111" }}>{u.calls.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#555" }}>{fmtTokens(u.inputTokens)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#555" }}>{fmtTokens(u.outputTokens)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: u.costUsd > 0.1 ? "#fee2e2" : "#f0fdf4", color: u.costUsd > 0.1 ? "#991b1b" : "#166534" }}>
                      {fmtCost(u.costUsd)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#888" }}>{sinceLabel(u.lastSeen)}</td>
                </tr>
              ))}
              {byUser.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: "#aaa" }}>Aucun appel sur cette période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 2: Par feature ────────────────────────────────────────────── */}
      {tab === "features" && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#eee" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                {["Feature", "Appels", "Tokens in", "Tokens out", "Coût total", "Coût / appel"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byFeature.map((f, i) => (
                <tr key={f.feature} style={{ borderBottom: i < byFeature.length - 1 ? "1px solid #f5f5f5" : undefined }}>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-1 rounded-lg" style={{ background: "#f5f5f5", color: "#111" }}>
                      {f.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: "#111" }}>{f.calls.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#555" }}>{fmtTokens(f.inputTokens)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#555" }}>{fmtTokens(f.outputTokens)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: f.costUsd > 0.05 ? "#fee2e2" : "#f0fdf4", color: f.costUsd > 0.05 ? "#991b1b" : "#166534" }}>
                      {fmtCost(f.costUsd)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#888" }}>{fmtCost(f.costUsd / Math.max(f.calls, 1))}</td>
                </tr>
              ))}
              {byFeature.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: "#aaa" }}>Aucun appel sur cette période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 3: User × Feature (nb appels) ───────────────────────────── */}
      {tab === "grid" && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "#eee" }}>
          <table className="text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9f9f9" }}>
                <th className="px-4 py-3 text-left font-semibold sticky left-0" style={{ color: "#555", background: "#f9f9f9", minWidth: 140, borderBottom: "1px solid #eee", borderRight: "1px solid #eee" }}>
                  Utilisateur
                </th>
                {allFeatures.map((f) => (
                  <th key={f} className="px-3 py-3 font-semibold whitespace-nowrap" style={{ color: "#555", borderBottom: "1px solid #eee", borderLeft: "1px solid #f0f0f0" }}>
                    {featureLabels[f] ?? f}
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold" style={{ color: "#555", borderBottom: "1px solid #eee", borderLeft: "1px solid #eee" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((u, ri) => {
                const uxf = byUserFeature[u.id] ?? {};
                const total = Object.values(uxf).reduce((s, n) => s + n, 0);
                return (
                  <tr key={u.id} style={{ borderBottom: ri < byUser.length - 1 ? "1px solid #f5f5f5" : undefined }}>
                    <td className="px-4 py-2.5 font-medium sticky left-0" style={{ color: "#111", background: "#fff", borderRight: "1px solid #eee" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0" style={{ background: "#f01563", color: "#fff" }}>
                          {initials(u.name)}
                        </div>
                        {u.name}
                      </div>
                    </td>
                    {allFeatures.map((f) => {
                      const n = uxf[f] ?? 0;
                      return (
                        <td key={f} className="px-3 py-2.5 text-center" style={{ borderLeft: "1px solid #f0f0f0", background: n > 0 ? "#fff0f5" : undefined }}>
                          {n > 0 ? <span className="font-semibold" style={{ color: "#f01563" }}>{n}</span> : <span style={{ color: "#ddd" }}>—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center font-semibold" style={{ color: "#111", borderLeft: "1px solid #eee" }}>{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 5: Features & Modèles ────────────────────────────────────── */}
      {tab === "catalog" && (
        <div className="space-y-2">
          <p className="text-xs mb-4" style={{ color: "#888" }}>
            Liste de toutes les features utilisant l&apos;IA, leur onglet, et les modèles observés dans les logs. Les modèles sont dérivés des appels réels — pas de données = feature jamais appelée sur cette période.
          </p>
          {Object.entries(FEATURE_DESCRIPTIONS).map(([key, desc]) => {
            const stat = byFeature.find((f) => f.feature === key);
            const models = featureModels[key] ?? [];
            return (
              <div
                key={key}
                className="flex items-start gap-4 rounded-xl border px-4 py-3"
                style={{ borderColor: "#eee", background: stat ? "#fff" : "#fafafa" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold" style={{ color: "#111" }}>
                      {featureLabels[key] ?? key}
                    </span>
                    {!stat && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f5f5f5", color: "#aaa" }}>
                        jamais appelé
                      </span>
                    )}
                  </div>
                  <p className="text-[11px]" style={{ color: "#888" }}>{desc}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {models.length > 0 ? models.map((m) => {
                    const c = MODEL_COLORS[m] ?? { bg: "#f5f5f5", text: "#555" };
                    return (
                      <span key={m} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>
                        {m}
                      </span>
                    );
                  }) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#f5f5f5", color: "#ccc" }}>—</span>
                  )}
                  {stat && (
                    <span className="text-[10px] font-medium" style={{ color: "#aaa" }}>
                      {stat.calls} appel{stat.calls > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB 4: Activité ──────────────────────────────────────────────── */}
      {tab === "activity" && (
        <div className="space-y-6">
          {/* Summary per user */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "#111" }}>Résumé par utilisateur</h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {byUser.map((u) => (
                <div key={u.id} className="rounded-xl border p-4" style={{ borderColor: "#eee", background: "#fff" }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: "#f01563", color: "#fff" }}>
                      {initials(u.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "#111" }}>{u.name}</p>
                      <p className="text-xs" style={{ color: "#888" }}>Dernière activité {sinceLabel(u.lastSeen)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-lg px-3 py-2" style={{ background: "#f9f9f9" }}>
                      <p className="text-[10px] font-medium mb-0.5" style={{ color: "#888" }}>Appels</p>
                      <p className="text-lg font-bold" style={{ color: "#111" }}>{u.calls}</p>
                    </div>
                    <div className="rounded-lg px-3 py-2" style={{ background: "#f9f9f9" }}>
                      <p className="text-[10px] font-medium mb-0.5" style={{ color: "#888" }}>Coût</p>
                      <p className="text-lg font-bold" style={{ color: "#f01563" }}>{fmtCost(u.costUsd)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {u.features.slice(0, 6).map((f) => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f0f4ff", color: "#3730a3" }}>
                        {featureLabels[f] ?? f}
                      </span>
                    ))}
                    {u.features.length > 6 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f5f5f5", color: "#888" }}>
                        +{u.features.length - 6}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detailed log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Log détaillé</h3>
              <div className="flex gap-2">
                <select
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-lg border outline-none"
                  style={{ borderColor: "#e5e5e5", color: "#555" }}
                >
                  <option value="">Tous les users</option>
                  {byUser.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select
                  value={filterFeature}
                  onChange={(e) => setFilterFeature(e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-lg border outline-none"
                  style={{ borderColor: "#e5e5e5", color: "#555" }}
                >
                  <option value="">Toutes les features</option>
                  {allFeatures.map((f) => <option key={f} value={f}>{featureLabels[f] ?? f}</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#eee" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                    {["Date", "Utilisateur", "Feature", "Tokens in", "Tokens out", "Coût", "Modèle"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 font-semibold" style={{ color: "#555" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs
                    .filter((l) => (!filterUser || l.user_id === filterUser) && (!filterFeature || l.feature === filterFeature))
                    .slice(0, 200)
                    .map((l, i) => (
                      <tr key={l.id ?? i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td className="px-3 py-2" style={{ color: "#888", whiteSpace: "nowrap" }}>{fmtDateShort(l.created_at)}</td>
                        <td className="px-3 py-2 font-medium" style={{ color: "#111" }}>{l.userName}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "#f0f4ff", color: "#3730a3" }}>
                            {l.featureLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ color: "#555" }}>{fmtTokens(l.input_tokens)}</td>
                        <td className="px-3 py-2" style={{ color: "#555" }}>{fmtTokens(l.output_tokens)}</td>
                        <td className="px-3 py-2 font-medium" style={{ color: "#f01563" }}>{fmtCost(l.costUsd)}</td>
                        <td className="px-3 py-2" style={{ color: "#aaa" }}>{l.model.replace("claude-", "").replace("-20251001", "")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
