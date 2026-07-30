// ────────────────────────────────────────────────────────────────────────
// Note Sales Coach par rep.
//
// On agrège les analyses Claap déjà en base (sales_coach_analyses.score_global)
// pour en tirer la moyenne mensuelle affichée en KPI. La recommandation de
// coaching générée par Claude a été retirée : seule la note reste.
// ────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import type { Coaching, MonthlyScore } from "./types";

// Le JSONB `analysis` n'a pas de schéma garanti : il a été écrit par plusieurs
// générations de prompt, et une clé attendue en tableau peut arriver en chaîne
// (ou l'objet entier en JSON sérialisé). Tout est donc lu en `unknown` puis
// normalisé — sans quoi un seul enregistrement malformé fait échouer la note
// du rep.
type AnalysisJson = {
  meeting_kind?: unknown;
};

function asAnalysis(v: unknown): AnalysisJson {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as AnalysisJson;
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as AnalysisJson) : {};
}

// Meetings internes : exclus de la note moyenne, qui ne doit refléter que la
// performance commerciale face à un prospect ou un client.
const INTERNAL_MEETING_KINDS = new Set(["internal", "interne"]);

/**
 * Note Claap moyenne par mois (score_global /10), meetings internes exclus.
 * Un mois sans meeting noté n'apparaît pas dans la liste (plutôt qu'un 0 qui se
 * lirait comme une très mauvaise note).
 */
function scoresByMonth(
  rows: Array<{ analysis: unknown; meeting_started_at: string | null; score_global: number | null }>,
): MonthlyScore[] {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    if (row.score_global == null || !row.meeting_started_at) continue;
    const kind = String(asAnalysis(row.analysis).meeting_kind ?? "").toLowerCase();
    if (INTERNAL_MEETING_KINDS.has(kind)) continue;
    const score = Number(row.score_global);
    if (!Number.isFinite(score)) continue;
    const month = row.meeting_started_at.slice(0, 7); // "YYYY-MM"
    const cur = acc.get(month) ?? { sum: 0, count: 0 };
    cur.sum += score;
    cur.count++;
    acc.set(month, cur);
  }
  return [...acc.entries()]
    .map(([month, { sum, count }]) => ({ month, avg: Math.round((sum / count) * 10) / 10, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Construit le bloc coaching d'un rep depuis ses analyses Sales Coach depuis
 * `startDay`. Best-effort : renvoie un bloc vide plutôt que throw.
 */
export async function buildCoaching(userId: string, startDay: string): Promise<Coaching> {
  const empty: Coaching = { meetingsAnalyzed: 0, scoreByMonth: [] };
  try {
    const { data } = await db
      .from("sales_coach_analyses")
      .select("analysis, meeting_started_at, score_global")
      .eq("user_id", userId)
      .not("analysis", "is", null)
      .gte("meeting_started_at", `${startDay}T00:00:00Z`)
      .order("meeting_started_at", { ascending: false })
      .limit(500);

    const rows = (data ?? []) as Array<{
      analysis: unknown;
      meeting_started_at: string | null;
      score_global: number | null;
    }>;
    if (rows.length === 0) return empty;

    return { meetingsAnalyzed: rows.length, scoreByMonth: scoresByMonth(rows) };
  } catch (e) {
    console.warn(`[ae-activity] coaching failed for ${userId}:`, e instanceof Error ? e.message : e);
    return empty;
  }
}
