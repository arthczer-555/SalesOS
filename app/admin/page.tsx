import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { UsersTable } from "./_components/users-table";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";
import { GuideEditor } from "../settings/_components/guide-editor";
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
  const globalMap = Object.fromEntries((globalGuides ?? []).map((r) => [r.key, r.content as string]));

  const { data: keys } = await db
    .from("user_keys")
    .select("user_id, is_active")
    .eq("service", "claude");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: allLogs }, { data: monthLogs }] = await Promise.all([
    db.from("usage_logs").select("user_id, model, input_tokens, output_tokens"),
    db.from("usage_logs").select("user_id, model, input_tokens, output_tokens").gte("created_at", monthStart),
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
          <Suspense>
            <GuideEditor
              initialGuide={globalMap.bot ?? null}
              defaultGuide={DEFAULT_BOT_GUIDE}
              endpoint="/api/admin/guides?key=bot"
              title="Guide bot"
              description="System prompt du chat Coachello Intelligence."
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
