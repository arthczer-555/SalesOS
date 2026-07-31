/**
 * Flux live de RAG Insights : les questions qui n'ont pas encore été jugées.
 *
 * L'analyse LLM ne tourne qu'au cron hebdo ou sur "Refresh analysis", donc sans
 * ça une question posée à l'instant reste invisible pendant des jours. On la
 * reconstruit ici à la volée depuis les mêmes sources que collect.ts, avec un
 * état :
 *   - "answering" : job chat encore en cours, la réponse s'écrit
 *   - "analyzing" : question ET réponse présentes, le juge n'est pas passé
 *
 * Aucun appel LLM : c'est de la lecture DB, la page peut poller sans coût.
 */

import { db } from "@/lib/db";
import { collectPendingTurns, questionFromMessages } from "./collect";
import type { RagPendingState, RagRow, RagTurn } from "./types";

/** Au-delà, un job "running" est un job mort : on ne l'affiche plus. */
const RUNNING_MAX_AGE_MS = 15 * 60_000;

const MAX_QUESTION = 2000;

function pendingRow(
  base: Pick<RagTurn, "source" | "sourceId" | "turnIndex" | "userId" | "askedAt" | "question"> & {
    answer?: string;
    notionPages?: RagTurn["notionPages"];
    guidesLoaded?: string[];
  },
  pending: RagPendingState,
): RagRow {
  return {
    // Pas de row en base : l'id sert uniquement de clé côté UI.
    id: `pending:${base.source}:${base.sourceId}:${base.turnIndex}`,
    source: base.source,
    source_id: base.sourceId,
    turn_index: base.turnIndex,
    user_id: base.userId,
    asked_at: base.askedAt,
    question: base.question,
    answer_excerpt: base.answer ?? null,
    answer_summary: null,
    issue: null,
    category: null,
    is_knowledge: false,
    used_notion: (base.notionPages ?? []).length > 0,
    notion_pages: base.notionPages ?? [],
    guides_loaded: base.guidesLoaded ?? [],
    verdict: null,
    satisfaction: null,
    satisfaction_basis: null,
    gap_summary: null,
    reasoning: null,
    model: null,
    pending,
  };
}

/** Jobs web encore en cours : la question existe, la réponse pas encore. */
async function fetchAnsweringRows(): Promise<RagRow[]> {
  const since = new Date(Date.now() - RUNNING_MAX_AGE_MS).toISOString();
  const { data, error } = await db
    .from("chat_jobs")
    .select("id, user_id, input_messages, created_at")
    .eq("status", "running")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[rag-insights/live] running jobs query failed:", error.message);
    return [];
  }

  const rows: RagRow[] = [];
  for (const job of data ?? []) {
    const question = questionFromMessages(job.input_messages);
    if (!question) continue;
    rows.push(
      pendingRow(
        {
          source: "web",
          sourceId: job.id as string,
          turnIndex: 0,
          userId: job.user_id as string,
          askedAt: job.created_at as string,
          question: question.slice(0, MAX_QUESTION),
        },
        "answering",
      ),
    );
  }
  return rows;
}

/**
 * Les tours de la fenêtre qui ne sont pas encore dans rag_question_analyses,
 * les plus récents d'abord. Prêts à être concaténés aux rows analysées.
 */
export async function fetchPendingRows(opts: { sinceDays: number }): Promise<RagRow[]> {
  const [turns, answering] = await Promise.all([
    collectPendingTurns({ sinceDays: opts.sinceDays }),
    fetchAnsweringRows(),
  ]);

  const analyzing = turns.map((t) =>
    pendingRow(
      {
        source: t.source,
        sourceId: t.sourceId,
        turnIndex: t.turnIndex,
        userId: t.userId,
        askedAt: t.askedAt,
        question: t.question,
        answer: t.answer,
        notionPages: t.notionPages,
        guidesLoaded: t.guidesLoaded,
      },
      "analyzing",
    ),
  );

  return [...answering, ...analyzing].sort((a, b) => b.asked_at.localeCompare(a.asked_at));
}
