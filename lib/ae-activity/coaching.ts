// ────────────────────────────────────────────────────────────────────────
// Coaching auto par rep, synthétisé depuis Sales Coach.
//
// On agrège les analyses Claap déjà en base (sales_coach_analyses.analysis :
// weaknesses, coaching_priorities, risks, objections des key_moments) puis
// Claude en tire UNE recommandation de 1-2 phrases.
//
// Le critère est la RÉCURRENCE : la reco doit porter sur ce qui revient dans le
// plus grand nombre de meetings, pas sur le point le plus spectaculaire d'un
// meeting isolé. On compte donc les occurrences par meeting distinct et on les
// passe au modèle. Dédupliquer avant l'appel (ce que faisait la version 3-5
// puces) détruisait précisément cette information.
// ────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import type { Coaching, MonthlyScore } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Le JSONB `analysis` n'a pas de schéma garanti : il a été écrit par plusieurs
// générations de prompt, et une clé attendue en tableau peut arriver en chaîne
// (ou l'objet entier en JSON sérialisé). Tout est donc lu en `unknown` puis
// normalisé — sans quoi un seul enregistrement malformé fait échouer le
// coaching ET la note du rep.
type AnalysisJson = {
  meeting_kind?: unknown;
  weaknesses?: unknown;
  coaching_priorities?: unknown;
  risks?: unknown;
  key_moments?: unknown;
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

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (typeof v === "string" && v.trim() !== "") return [v];
  return [];
}

function asKeyMoments(v: unknown): Array<{ kind?: string; label?: string; quote?: string }> {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is { kind?: string; label?: string; quote?: string } => !!x && typeof x === "object");
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

const COACHING_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
// Nombre de signaux passés au modèle par catégorie. Les plus fréquents d'abord :
// au-delà on ne fait qu'ajouter du bruit one-off au prompt.
const MAX_SIGNALS_PER_LIST = 25;
// Durée de vie d'une reco : une par sales et par semaine, alignée sur le cron.
// Légèrement sous 7 jours pour qu'un cron hebdo qui tourne à la minute près ne
// tombe pas du mauvais côté du seuil et ne saute pas une semaine.
const RECO_MAX_AGE_MS = 6.5 * 24 * 60 * 60_000;

// Le produit est en anglais : la reco s'affiche telle quelle dans le dashboard
// du rep et dans AE Activity, elle doit donc être rédigée en anglais.
const SYSTEM_PROMPT = `You are a sales manager writing ONE coaching recommendation for an AE, based on signals aggregated from their recent meetings (recurring weaknesses, coaching priorities, risks, objections).

Each signal comes with the number of distinct meetings it appeared in, written as "(seen in N meetings)".

Your job: identify the SINGLE pattern that shows up in the largest number of meetings, and turn it into one recommendation of 1 to 2 sentences.

Rules:
- Pick recurrence over severity: a point seen in 9 meetings beats a dramatic one seen once.
- Group signals that say the same thing in different words, and count their meetings together.
- Write it as a direct instruction to the rep ("Ask for the budget before...", "Stop presenting the pricing before...").
- Stay factual: never invent anything that is not in the signals.
- Keep the HubSpot sales vocabulary (pipeline, deal, discovery, closing, objection).
- 2 sentences maximum. No preamble, no bullet points.
- Never use an em dash.

Answer ONLY through the emit_recommendation tool.`;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_recommendation",
  description: "Returns the single most recurring coaching recommendation for this rep.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendation: {
        type: "string",
        description: "One coaching recommendation, 1 to 2 sentences, in English, addressed to the rep.",
      },
    },
    required: ["recommendation"],
  },
};

/**
 * Signaux triés par nombre de MEETINGS DISTINCTS où ils apparaissent. Deux
 * meetings peuvent formuler le même reproche différemment : le regroupement
 * sémantique est laissé au modèle, on ne fusionne ici que les formulations
 * strictement identiques (casse et ponctuation finale ignorées).
 */
type Signal = { text: string; meetings: number };

function rankByRecurrence(perMeeting: string[][]): Signal[] {
  const acc = new Map<string, { text: string; meetings: Set<number> }>();
  perMeeting.forEach((items, meetingIdx) => {
    const seenInThisMeeting = new Set<string>();
    for (const item of items) {
      const text = item.trim();
      const key = text.toLowerCase().replace(/[.!?;:]+$/, "");
      if (!key || seenInThisMeeting.has(key)) continue;
      seenInThisMeeting.add(key);
      const cur = acc.get(key) ?? { text, meetings: new Set<number>() };
      cur.meetings.add(meetingIdx);
      acc.set(key, cur);
    }
  });
  return [...acc.values()]
    .map((s) => ({ text: s.text, meetings: s.meetings.size }))
    .sort((a, b) => b.meetings - a.meetings)
    .slice(0, MAX_SIGNALS_PER_LIST);
}

async function recommend(
  repName: string,
  meetingsCount: number,
  lists: { weaknesses: Signal[]; priorities: Signal[]; risks: Signal[]; objections: Signal[] },
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const model = await getModelPreference("sales_coach", COACHING_FALLBACK_MODEL);

  const block = (title: string, items: Signal[]) =>
    items.length
      ? `${title}:\n${items.map((i) => `- ${i.text} (seen in ${i.meetings} meeting${i.meetings > 1 ? "s" : ""})`).join("\n")}`
      : "";
  const userMsg = [
    `Rep: ${repName}`,
    `Meetings analysed: ${meetingsCount}`,
    ``,
    block("Recurring weaknesses", lists.weaknesses),
    block("Coaching priorities", lists.priorities),
    block("Risks flagged", lists.risks),
    block("Objections faced (verbatim)", lists.objections),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const client = anthropicClient({ timeout: 40_000 });
    const msg = await client.messages.create({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      tools: [EMIT_TOOL],
      tool_choice: { type: "tool" as const, name: "emit_recommendation" },
    });
    logUsage(null, model, msg.usage.input_tokens, msg.usage.output_tokens, "ae_coaching");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) return null;
    const input = toolBlock.input as { recommendation?: unknown };
    const text = typeof input.recommendation === "string" ? input.recommendation.trim() : "";
    return text || null;
  } catch (e) {
    console.warn(`[ae-activity] recommendation failed for ${repName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Construit le coaching d'un rep depuis ses analyses Sales Coach depuis
 * `startDay`. Best-effort partout : renvoie une reco vide plutôt que throw.
 *
 * `previous` = coaching du snapshot précédent. Le refresh tourne désormais tous
 * les jours (et à la demande), alors que Sales Coach n'ajoute une analyse qu'à
 * chaque meeting : sans nouvelle analyse depuis la dernière génération, on
 * réutilise la reco au lieu de repayer un appel Claude pour le même verdict.
 */
export async function buildCoaching(
  userId: string,
  repName: string,
  startDay: string,
  previous?: Coaching | null,
): Promise<Coaching> {
  const empty: Coaching = { recommendation: null, meetingsAnalyzed: 0, generatedAt: null, scoreByMonth: [] };
  try {
    // Limite haute : la synthèse de coaching se contente des plus récents, mais
    // la note mensuelle doit couvrir toute la période.
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

    const scoreByMonth = scoresByMonth(rows);
    const now = new Date().toISOString();

    // Un tableau par meeting : c'est ce qui permet de compter la récurrence en
    // nombre de meetings distincts plutôt qu'en nombre de mentions.
    const weaknesses: string[][] = [];
    const priorities: string[][] = [];
    const risks: string[][] = [];
    const objections: string[][] = [];
    for (const row of rows) {
      const a = asAnalysis(row.analysis);
      weaknesses.push(asStringList(a.weaknesses));
      priorities.push(asStringList(a.coaching_priorities));
      risks.push(asStringList(a.risks));
      objections.push(
        asKeyMoments(a.key_moments)
          .filter((k) => k.kind === "objection")
          .map((k) => k.quote || k.label || "")
          .filter(Boolean),
      );
    }

    const signals = {
      weaknesses: rankByRecurrence(weaknesses),
      priorities: rankByRecurrence(priorities),
      risks: rankByRecurrence(risks),
      objections: rankByRecurrence(objections),
    };
    const signalCount =
      signals.weaknesses.length + signals.priorities.length + signals.risks.length + signals.objections.length;
    if (signalCount === 0) {
      return { recommendation: null, meetingsAnalyzed: rows.length, generatedAt: now, scoreByMonth };
    }

    // Reco encore valable : on la garde telle quelle. Le snapshot, lui, se
    // recalcule bien plus souvent (cron quotidien + refresh à l'ouverture d'un
    // dashboard périmé), mais un axe de coaching ne change pas en trois heures
    // et le rep a besoin de temps pour l'appliquer. Cette garde plafonne donc
    // le coût à UN appel Claude par sales et par semaine, quel que soit le
    // nombre de refresh.
    const age = previous?.generatedAt ? Date.now() - new Date(previous.generatedAt).getTime() : Infinity;
    if (previous?.recommendation && age < RECO_MAX_AGE_MS) {
      return {
        recommendation: previous.recommendation,
        meetingsAnalyzed: rows.length,
        generatedAt: previous.generatedAt,
        scoreByMonth,
      };
    }

    const recommendation = await recommend(repName, rows.length, signals);
    return { recommendation, meetingsAnalyzed: rows.length, generatedAt: now, scoreByMonth };
  } catch (e) {
    console.warn(`[ae-activity] coaching failed for ${userId}:`, e instanceof Error ? e.message : e);
    return empty;
  }
}
