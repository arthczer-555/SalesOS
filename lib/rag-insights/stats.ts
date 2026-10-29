/**
 * Agrégats déterministes sur les tours analysés. Aucune couche LLM ici : les
 * mêmes chiffres servent la page admin, le rapport de gaps et le recap Slack.
 */

import { db } from "@/lib/db";
import { RAG_CATEGORIES, type RagAnalysisRow, type RagCategory, type RagStats } from "./types";

export async function fetchAnalyses(opts: {
  sinceDays: number;
  limit?: number;
}): Promise<RagAnalysisRow[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
  const { data, error } = await db
    .from("rag_question_analyses")
    .select("*")
    .gte("asked_at", since)
    .order("asked_at", { ascending: false })
    .limit(opts.limit ?? 2000);

  if (error) {
    console.error("[rag-insights/stats] query failed:", error.message);
    return [];
  }
  return (data ?? []) as RagAnalysisRow[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computeStats(rows: RagAnalysisRow[]): RagStats {
  const scored = rows.filter((r) => typeof r.satisfaction === "number");
  const knowledge = rows.filter((r) => r.is_knowledge);

  const byCategory = RAG_CATEGORIES.map((category) => {
    const sub = rows.filter((r) => r.category === category);
    return {
      category: category as RagCategory,
      count: sub.length,
      avgSatisfaction: average(
        sub.filter((r) => typeof r.satisfaction === "number").map((r) => r.satisfaction as number),
      ),
    };
  })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    web: rows.filter((r) => r.source === "web").length,
    slack: rows.filter((r) => r.source === "slack").length,
    knowledge: knowledge.length,
    avgSatisfaction: average(scored.map((r) => r.satisfaction as number)),
    avgKnowledgeSatisfaction: average(
      knowledge
        .filter((r) => typeof r.satisfaction === "number")
        .map((r) => r.satisfaction as number),
    ),
    unanswered: rows.filter((r) => r.verdict === "missing_info" || r.verdict === "wrong").length,
    thumbsDown: rows.filter((r) => r.satisfaction_basis === "explicit" && (r.satisfaction ?? 100) <= 30)
      .length,
    byCategory,
  };
}

/**
 * Nombre de questions par auteur, web et Slack séparés, du plus gros
 * utilisateur au plus petit. `userId` null = conversation Slack dont l'auteur
 * n'est relié à aucun compte CoachelloHQ.
 */
export function usageByUser(
  rows: RagAnalysisRow[],
): { userId: string | null; total: number; web: number; slack: number }[] {
  const byUser = new Map<string | null, { web: number; slack: number }>();
  for (const r of rows) {
    const entry = byUser.get(r.user_id) ?? { web: 0, slack: 0 };
    entry[r.source] += 1;
    byUser.set(r.user_id, entry);
  }
  return [...byUser.entries()]
    .map(([userId, c]) => ({ userId, total: c.web + c.slack, ...c }))
    .sort((a, b) => b.total - a.total);
}

/** Les tours à problème, du pire au moins pire (base des gaps et du recap). */
export function failingTurns(rows: RagAnalysisRow[]): RagAnalysisRow[] {
  return rows
    .filter((r) => r.verdict === "missing_info" || r.verdict === "wrong" || r.verdict === "partial")
    .sort((a, b) => (a.satisfaction ?? 100) - (b.satisfaction ?? 100));
}

/** Les 👎 explicites, les plus récents d'abord. */
export function thumbsDownTurns(rows: RagAnalysisRow[]): RagAnalysisRow[] {
  return rows
    .filter((r) => r.satisfaction_basis === "explicit" && (r.satisfaction ?? 100) <= 30)
    .sort((a, b) => b.asked_at.localeCompare(a.asked_at));
}
