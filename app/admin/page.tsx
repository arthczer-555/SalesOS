import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { UsersTable } from "./_components/users-table";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/default-guide";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { data: users } = await db
    .from("users")
    .select("id, email, name, created_at, is_admin, prospection_guide")
    .order("created_at", { ascending: true });

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

  const guideCustomCount = (users ?? []).filter((u) => u.prospection_guide).length;

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

      {/* Prospection guide */}
      <div>
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-base font-semibold" style={{ color: "#111" }}>
              Guide de prospection
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#475569" }}>
              {guideCustomCount} / {(users ?? []).length} personnalisé(s)
            </span>
          </div>
          <p className="text-xs" style={{ color: "#888" }}>
            Ce guide par défaut est utilisé par l&apos;IA pour tous les utilisateurs n&apos;ayant pas encore personnalisé le leur. Chaque utilisateur peut modifier son propre guide dans Paramètres.
          </p>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#eeeeee" }}>
          <div className="px-4 py-2 border-b flex items-center gap-2" style={{ background: "#f9f9f9", borderColor: "#eeeeee" }}>
            <span className="text-xs font-medium" style={{ color: "#555" }}>Guide par défaut (hardcodé)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>
              Modifier dans lib/default-guide.ts
            </span>
          </div>
          <pre
            className="p-4 text-xs overflow-x-auto"
            style={{ color: "#555", lineHeight: "1.7", whiteSpace: "pre-wrap", background: "#fff" }}
          >
            {DEFAULT_PROSPECTION_GUIDE}
          </pre>
        </div>

        {guideCustomCount > 0 && (
          <div className="mt-3 space-y-1">
            {(users ?? []).filter((u) => u.prospection_guide).map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "#f9f9f9" }}>
                <span style={{ color: "#111" }}>{u.name ?? u.email}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#dbeafe", color: "#1e40af" }}>
                  Guide personnalisé
                </span>
                <span style={{ color: "#aaa" }}>
                  {u.prospection_guide!.length} chars
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
