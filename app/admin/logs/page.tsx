import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { UsageTabs } from "./_components/usage-tabs";

export const dynamic = "force-dynamic";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":        { input: 1,  output: 5  },
  "claude-haiku-4-5-20251001": { input: 1, output: 5  },
  "claude-sonnet-4-6":       { input: 3,  output: 15 },
  "claude-opus-4-6":         { input: 5,  output: 25 },
};
const DEFAULT_PRICE = { input: 1, output: 5 };

function cost(model: string, input: number, output: number) {
  const p = PRICING[model] ?? DEFAULT_PRICE;
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

const FEATURE_LABELS: Record<string, string> = {
  chat:                    "Chat",
  briefing:                "Briefing",
  market_scan:             "Market — Scan",
  market_signals:          "Market — Signaux",
  market_context:          "Market — Contexte",
  market_contacts:         "Market — Contacts",
  prospection_search:      "Prospection — Recherche IA",
  prospection_generate:    "Prospection — Email",
  prospection_bulk:        "Prospection — Email en masse",
  prospection_details:     "Prospection — Détails",
  deals_analyze:           "Deals — Analyse",
  deals_email:             "Deals — Email",
  deals_score:             "Deals — Score",
  conversations:           "Chat — Titre auto (Haiku)",
};

export type RawLog = {
  id: string;
  user_id: string | null;
  model: string;
  feature: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

// Clé d'agrégation pour les appels sans user attribué (cron, webhooks,
// résolveurs internes). Affichée comme "Système (cron / non-attribué)".
const SYSTEM_USER_KEY = "__system__";
const SYSTEM_USER_LABEL = "Système (cron / non-attribué)";

export type UserMeta = { id: string; name: string | null; email: string };

export default async function AdminLogsPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");

  const [{ data: logs }, { data: users }, { data: globalModelEntry }] = await Promise.all([
    db.from("usage_logs")
      .select("id, user_id, model, feature, input_tokens, output_tokens, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("users").select("id, name, email"),
    db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
  ]);

  let globalModelPrefs: Record<string, string> = {};
  try { if (globalModelEntry?.content) globalModelPrefs = JSON.parse(globalModelEntry.content); } catch { /* ignore */ }

  const userMap = new Map<string, UserMeta>((users ?? []).map((u) => [u.id, u]));

  // ── Aggregate: by user ────────────────────────────────────────────────────
  type UserStat = {
    id: string; name: string; calls: number;
    inputTokens: number; outputTokens: number; costUsd: number; lastSeen: string;
    features: Set<string>;
  };
  const byUser = new Map<string, UserStat>();
  for (const log of logs ?? []) {
    const key = log.user_id ?? SYSTEM_USER_KEY;
    const u = log.user_id ? userMap.get(log.user_id) : null;
    const name = log.user_id ? (u?.name ?? u?.email ?? log.user_id) : SYSTEM_USER_LABEL;
    const cur = byUser.get(key) ?? { id: key, name, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, lastSeen: log.created_at, features: new Set<string>() };
    cur.calls++;
    cur.inputTokens += log.input_tokens;
    cur.outputTokens += log.output_tokens;
    cur.costUsd += cost(log.model, log.input_tokens, log.output_tokens);
    if (log.created_at > cur.lastSeen) cur.lastSeen = log.created_at;
    if (log.feature) cur.features.add(log.feature);
    byUser.set(key, cur);
  }

  // ── Aggregate: by feature ─────────────────────────────────────────────────
  type FeatureStat = { feature: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  const byFeature = new Map<string, FeatureStat>();
  for (const log of logs ?? []) {
    const key = log.feature ?? "unknown";
    const cur = byFeature.get(key) ?? { feature: key, label: FEATURE_LABELS[key] ?? key, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    cur.calls++;
    cur.inputTokens += log.input_tokens;
    cur.outputTokens += log.output_tokens;
    cur.costUsd += cost(log.model, log.input_tokens, log.output_tokens);
    byFeature.set(key, cur);
  }

  // ── Aggregate: user × feature (call count) ───────────────────────────────
  const byUserFeature: Record<string, Record<string, number>> = {};
  for (const log of logs ?? []) {
    const f = log.feature ?? "unknown";
    const key = log.user_id ?? SYSTEM_USER_KEY;
    if (!byUserFeature[key]) byUserFeature[key] = {};
    byUserFeature[key][f] = (byUserFeature[key][f] ?? 0) + 1;
  }

  // Serialise Sets
  const byUserSerial = Array.from(byUser.values()).map((u) => ({
    ...u, features: Array.from(u.features),
  })).sort((a, b) => b.costUsd - a.costUsd);

  const byFeatureSerial = Array.from(byFeature.values()).sort((a, b) => b.costUsd - a.costUsd);

  const allFeatures = byFeatureSerial.map((f) => f.feature);

  const rawLogs = (logs ?? []).map((l) => ({
    ...l,
    // Normalise les calls système (user_id null) avec une clé sentinelle.
    // Le client traite tout comme une string et affiche le label dédié.
    user_id: l.user_id ?? SYSTEM_USER_KEY,
    userName: l.user_id
      ? (userMap.get(l.user_id)?.name ?? userMap.get(l.user_id)?.email ?? l.user_id)
      : SYSTEM_USER_LABEL,
    featureLabel: FEATURE_LABELS[l.feature ?? ""] ?? l.feature ?? "—",
    costUsd: cost(l.model, l.input_tokens, l.output_tokens),
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <a href="/admin" className="text-sm" style={{ color: "#aaa" }}>← Admin</a>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "#111" }}>Logs & Usage</h1>
          <p className="text-sm mt-0.5" style={{ color: "#888" }}>
            {(logs ?? []).length} appels Claude enregistrés
          </p>
        </div>
      </div>

      <UsageTabs
        byUser={byUserSerial}
        byFeature={byFeatureSerial}
        allFeatures={allFeatures}
        byUserFeature={byUserFeature}
        rawLogs={rawLogs}
        featureLabels={FEATURE_LABELS}
        globalModelPrefs={globalModelPrefs}
      />
    </div>
  );
}
