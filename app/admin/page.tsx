import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { UsersTable } from "./_components/users-table";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";
import { GuideEditor } from "../settings/_components/guide-editor";
import { ModelPreferencesAdmin } from "./_components/model-preferences-admin";
import { AlertConfigAdmin } from "./_components/alert-config-admin";
import { ResetGuidesButton } from "./_components/reset-guides-button";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { data: users } = await db
    .from("users")
    .select("id, email, name, created_at, is_admin, prospection_guide")
    .order("created_at", { ascending: true });

  const { data: globalGuides } = await db.from("guide_defaults").select("key, content");
  const globalModelPrefs = (() => {
    const entry = (globalGuides ?? []).find((r) => r.key === "model_preferences");
    try { return entry ? (JSON.parse(entry.content as string) as Record<string, string>) : {}; } catch { return {}; }
  })();
  const globalMap = Object.fromEntries((globalGuides ?? []).map((r) => [r.key, r.content as string]));

  const { data: keys } = await db
    .from("user_keys")
    .select("user_id, is_active")
    .eq("service", "claude");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Supabase returns max 1000 rows by default — paginate to get all logs
  type LogRow = { user_id: string; model: string; input_tokens: number; output_tokens: number };
  async function fetchAllLogs(filter?: { gte?: { col: string; val: string } }): Promise<LogRow[]> {
    const all: LogRow[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      let q = db.from("usage_logs").select("user_id, model, input_tokens, output_tokens");
      if (filter?.gte) q = q.gte(filter.gte.col, filter.gte.val);
      const { data } = await q.range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as LogRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  const [allLogs, monthLogs] = await Promise.all([
    fetchAllLogs(),
    fetchAllLogs({ gte: { col: "created_at", val: monthStart } }),
  ]);

  const keyMap = new Map((keys ?? []).map((k) => [k.user_id, k.is_active]));

  // Pricing per model ($/M tokens)
  const PRICING: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5":  { input: 1, output: 5  },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-opus-4-6":   { input: 5, output: 25 },
  };
  const DEFAULT_PRICE = { input: 1, output: 5 };

  type UsageStat = { input: number; output: number; costUsd: number };
  const EMPTY: UsageStat = { input: 0, output: 0, costUsd: 0 };

  function aggregate(logs: typeof allLogs): Map<string, UsageStat> {
    const map = new Map<string, UsageStat>();
    for (const log of logs ?? []) {
      const cur = map.get(log.user_id) ?? { ...EMPTY };
      const price = PRICING[log.model] ?? DEFAULT_PRICE;
      map.set(log.user_id, {
        input: cur.input + log.input_tokens,
        output: cur.output + log.output_tokens,
        costUsd: cur.costUsd
          + (log.input_tokens / 1_000_000) * price.input
          + (log.output_tokens / 1_000_000) * price.output,
      });
    }
    return map;
  }

  const totalMap = aggregate(allLogs);
  const monthMap = aggregate(monthLogs);

  const usersWithStatus = (users ?? []).map((u) => ({
    ...u,
    claude_key_active: keyMap.get(u.id) ?? false,
    usageTotal: totalMap.get(u.id) ?? { ...EMPTY },
    usageMonth: monthMap.get(u.id) ?? { ...EMPTY },
  }));


  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "#111" }}>Admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/ga4-debug"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "#f4f4f4", color: "#333", border: "1px solid #e5e5e5" }}
          >
            GA4 Debug →
          </a>
          <a
            href="/admin/logs"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "#f4f4f4", color: "#333", border: "1px solid #e5e5e5" }}
          >
            Logs &amp; Usage →
          </a>
        </div>
      </div>

      {/* Users */}
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold" style={{ color: "#111" }}>
            Gestion des utilisateurs
          </h1>
          <p className="text-sm mt-1" style={{ color: "#888" }}>
            Configure les clés API Claude pour chaque membre de l&apos;équipe.
          </p>
        </div>
        <UsersTable users={usersWithStatus} />
      </div>

      {/* Modèles IA */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-semibold" style={{ color: "#111" }}>Modèles IA</h2>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            Modèle Claude utilisé par défaut pour chaque feature. S&apos;applique à tous les utilisateurs.
          </p>
        </div>
        <div className="rounded-xl border p-5" style={{ borderColor: "#eeeeee", background: "#fff" }}>
          <ModelPreferencesAdmin initialPreferences={globalModelPrefs} />
        </div>
      </div>

      {/* Alertes Market Intel */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-semibold" style={{ color: "#111" }}>Alertes Market Intel</h2>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            Configuration des alertes Slack pour les signaux prioritaires.
          </p>
        </div>
        <div className="rounded-xl border p-5" style={{ borderColor: "#eeeeee", background: "#fff" }}>
          <AlertConfigAdmin initialConfig={(() => {
            try {
              const raw = globalMap.alert_config;
              return raw ? JSON.parse(raw) : null;
            } catch { return null; }
          })()} />
        </div>
      </div>

      {/* Guides IA */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-semibold" style={{ color: "#111" }}>
            Guides IA
          </h2>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            Ces guides sont les valeurs par défaut pour tous les utilisateurs. Chaque utilisateur peut ensuite personnaliser les siens dans Paramètres.
          </p>
        </div>
        <div className="space-y-3">
          <ResetGuidesButton />
          <Suspense>
            <GuideEditor
              initialGuide={globalMap.bot ?? null}
              defaultGuide={DEFAULT_BOT_GUIDE}
              endpoint="/api/admin/guides?key=bot"
              title="Guide bot"
              description="System prompt du chat CoachelloGPT."
            />
            <GuideEditor
              initialGuide={globalMap.prospection ?? null}
              defaultGuide={DEFAULT_PROSPECTION_GUIDE}
              endpoint="/api/admin/guides?key=prospection"
              title="Guide de prospection"
              description="Instructions pour générer les emails dans Prospection et Market Intel."
            />
            <GuideEditor
              initialGuide={globalMap.briefing ?? null}
              defaultGuide={DEFAULT_BRIEFING_GUIDE}
              endpoint="/api/admin/guides?key=briefing"
              title="Guide de briefing"
              description="Instructions pour préparer les briefings pré-meeting."
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
