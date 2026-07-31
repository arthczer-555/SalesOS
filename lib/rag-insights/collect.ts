/**
 * Collecte des tours de conversation de CoachelloGPT pour RAG Insights.
 *
 * Aucune instrumentation nouvelle du chat : tout est déjà persisté, donc
 * l'historique est analysable rétroactivement.
 *   - web   : chat_jobs (une row = un tour, avec sources Notion et tool_steps)
 *   - Slack : slack_chat_threads.messages (l'historique Anthropic complet)
 *
 * Les tours déjà présents dans rag_question_analyses sont exclus : l'analyse
 * LLM ne repasse jamais sur ce qui a déjà été jugé.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { RagNotionPage, RagTurn } from "./types";

// Garde-fou : au-delà, on tronque (le juge n'a pas besoin de plus, et une
// question de 20k caractères est un copier-coller, pas une question).
const MAX_QUESTION = 2000;
const MAX_ANSWER = 4000;
const MAX_REPLY = 600;

type ContentBlock = { type?: string; text?: string };

function blocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

/**
 * Texte d'un VRAI message user. L'historique rejoué contient aussi des messages
 * role:"user" qui ne portent que des tool_result (retours d'outils) : ceux-là ne
 * sont pas des questions, on les écarte.
 */
function userText(msg: Anthropic.MessageParam): string | null {
  const parts = blocks(msg.content);
  if (parts.some((b) => b.type === "tool_result")) return null;
  const text = parts
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  return text || null;
}

function assistantText(msg: Anthropic.MessageParam): string | null {
  const text = blocks(msg.content)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  return text || null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Clé de conversation côté web : le front renvoie tout l'historique à chaque
 * tour, donc deux jobs d'une même conversation partagent leur première question. */
function conversationKey(userId: string, messages: Anthropic.MessageParam[]): string {
  const first = messages.find((m) => m.role === "user" && userText(m));
  const head = first ? (userText(first) ?? "") : "";
  return `${userId}::${head.slice(0, 200)}`;
}

// ── Web (chat_jobs) ──────────────────────────────────────────────────────────

type JobRow = {
  id: string;
  user_id: string;
  input_messages: Anthropic.MessageParam[] | null;
  final_text: string | null;
  sources: { kind?: string; title?: string; url?: string }[] | null;
  tool_steps: { name?: string | null; label?: string }[] | null;
  feedback: string | null;
  created_at: string;
};

function notionPagesOf(sources: JobRow["sources"]): RagNotionPage[] {
  const seen = new Set<string>();
  const out: RagNotionPage[] = [];
  for (const s of sources ?? []) {
    if (s.kind !== "notion" || !s.title) continue;
    const key = s.url ?? s.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: s.title, url: s.url });
  }
  return out;
}

/** Packs chargés via load_guide : le libellé de l'étape porte le nom du pack. */
function guidesOf(toolSteps: JobRow["tool_steps"]): string[] {
  const out = new Set<string>();
  for (const step of toolSteps ?? []) {
    if (step?.name !== "load_guide") continue;
    const label = (step.label ?? "").trim();
    const match = label.match(/[:：]\s*(.+)$/);
    out.add(match ? match[1].trim() : label || "load_guide");
  }
  return [...out];
}

async function collectWebTurns(since: string): Promise<RagTurn[]> {
  const { data, error } = await db
    .from("chat_jobs")
    .select("id, user_id, input_messages, final_text, sources, tool_steps, feedback, created_at")
    .eq("status", "done")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (error) {
    console.error("[rag-insights/collect] chat_jobs query failed:", error.message);
    return [];
  }

  const jobs = (data ?? []) as JobRow[];

  // Regroupement par conversation pour retrouver la RÉACTION du user : le tour
  // suivant de la même conversation porte, en dernier message user, ce que le
  // user a répondu à la réponse précédente.
  const byConversation = new Map<string, JobRow[]>();
  for (const job of jobs) {
    const messages = Array.isArray(job.input_messages) ? job.input_messages : [];
    if (messages.length === 0) continue;
    const key = conversationKey(job.user_id, messages);
    const bucket = byConversation.get(key);
    if (bucket) bucket.push(job);
    else byConversation.set(key, [job]);
  }

  const nextQuestion = new Map<string, string>();
  for (const bucket of byConversation.values()) {
    for (let i = 0; i < bucket.length - 1; i++) {
      const followUp = lastUserQuestion(bucket[i + 1]);
      if (followUp) nextQuestion.set(bucket[i].id, followUp);
    }
  }

  const turns: RagTurn[] = [];
  for (const job of jobs) {
    const question = lastUserQuestion(job);
    const answer = (job.final_text ?? "").trim();
    if (!question || !answer) continue;
    turns.push({
      source: "web",
      sourceId: job.id,
      turnIndex: 0,
      userId: job.user_id,
      askedAt: job.created_at,
      question: truncate(question, MAX_QUESTION),
      answer: truncate(answer, MAX_ANSWER),
      notionPages: notionPagesOf(job.sources),
      guidesLoaded: guidesOf(job.tool_steps),
      userReply: nextQuestion.has(job.id) ? truncate(nextQuestion.get(job.id) as string, MAX_REPLY) : null,
      feedback: job.feedback === "up" || job.feedback === "down" ? job.feedback : null,
    });
  }
  return turns;
}

function lastUserQuestion(job: JobRow): string | null {
  return questionFromMessages(job.input_messages);
}

/** Dernière vraie question user d'un historique (aussi utilisée par live.ts). */
export function questionFromMessages(input: unknown): string | null {
  const messages = Array.isArray(input) ? (input as Anthropic.MessageParam[]) : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const text = userText(messages[i]);
    if (text) return text;
  }
  return null;
}

// ── Slack (slack_chat_threads) ───────────────────────────────────────────────

type ThreadRow = {
  id: string;
  user_id: string | null;
  messages: Anthropic.MessageParam[] | null;
  created_at: string;
  updated_at: string;
};

/**
 * Slack ne date pas chaque message : la row porte created_at (1er message) et
 * updated_at (dernier). On interpole linéairement pour dater chaque tour, ce
 * qui suffit à ranger les tours dans la bonne fenêtre hebdo.
 */
function interpolatedDate(row: ThreadRow, index: number, total: number): string {
  const start = new Date(row.created_at).getTime();
  const end = new Date(row.updated_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || total <= 1 || end <= start) {
    return row.updated_at;
  }
  return new Date(start + ((end - start) * index) / (total - 1)).toISOString();
}

/** Tours d'un thread Slack, dans l'ordre. */
function turnsFromThread(row: ThreadRow): RagTurn[] {
  const messages = Array.isArray(row.messages) ? row.messages : [];

  // Déroulé : question user -> TOUT le texte que l'assistant produit ensuite
  // -> question user suivante (qui sert aussi de réaction au tour précédent).
  // On concatène les blocs assistant : une réponse Slack commence souvent par
  // un préambule ("Je vais chercher...") avant l'appel d'outil, et la vraie
  // réponse n'arrive qu'après le tool_result. Ne garder que le premier bloc
  // ferait juger un préambule à la place de la réponse.
  const pairs: { question: string; answer: string }[] = [];
  let pending: string | null = null;
  let answer = "";
  const flush = () => {
    if (pending && answer.trim()) pairs.push({ question: pending, answer: answer.trim() });
    pending = null;
    answer = "";
  };
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = userText(msg);
      if (!text) continue; // tool_result : la réponse en cours continue
      flush();
      pending = text;
      continue;
    }
    if (msg.role === "assistant" && pending) {
      const text = assistantText(msg);
      if (text) answer += (answer ? "\n" : "") + text;
    }
  }
  flush();

  return pairs.map((pair, i) => ({
    source: "slack" as const,
    sourceId: row.id,
    turnIndex: i,
    userId: row.user_id,
    askedAt: interpolatedDate(row, i, pairs.length),
    question: truncate(pair.question, MAX_QUESTION),
    answer: truncate(pair.answer, MAX_ANSWER),
    // Les sources et les guides ne sont pas persistés côté Slack : on les
    // déduit du texte de la réponse (citations "Source : [Titre](notion.so/...)").
    notionPages: notionCitations(pair.answer),
    guidesLoaded: [],
    userReply: pairs[i + 1] ? truncate(pairs[i + 1].question, MAX_REPLY) : null,
    feedback: null,
  }));
}

async function fetchSlackThreads(since: string): Promise<ThreadRow[]> {
  const { data, error } = await db
    .from("slack_chat_threads")
    .select("id, user_id, messages, created_at, updated_at")
    .gte("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[rag-insights/collect] slack_chat_threads query failed:", error.message);
    return [];
  }
  return (data ?? []) as ThreadRow[];
}

async function collectSlackTurns(since: string): Promise<RagTurn[]> {
  const threads = await fetchSlackThreads(since);
  return threads.flatMap(turnsFromThread);
}

/** Liens Notion cités en markdown dans une réponse Slack. */
function notionCitations(answer: string): RagNotionPage[] {
  const out: RagNotionPage[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]{1,120})\]\((https?:\/\/(?:www\.)?notion\.so\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ title: m[1], url: m[2] });
  }
  return out;
}

// ── Entrée principale ────────────────────────────────────────────────────────

const turnKey = (t: { source: string; sourceId: string; turnIndex: number }) =>
  `${t.source}::${t.sourceId}::${t.turnIndex}`;

/** Clés des tours déjà jugés sur la fenêtre. `null` si la requête échoue. */
async function analyzedKeys(since: string): Promise<Set<string> | null> {
  const { data, error } = await db
    .from("rag_question_analyses")
    .select("source, source_id, turn_index")
    .gte("asked_at", since)
    .limit(10_000);

  if (error) {
    console.error("[rag-insights/collect] existing analyses query failed:", error.message);
    return null;
  }
  return new Set((data ?? []).map((r) => `${r.source}::${r.source_id}::${r.turn_index}`));
}

/**
 * Tours des `sinceDays` derniers jours, hors tours déjà analysés.
 * Triés du plus ancien au plus récent (l'analyse suit l'ordre chronologique).
 */
export async function collectTurns(opts: { sinceDays: number }): Promise<RagTurn[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();

  const [web, slack] = await Promise.all([collectWebTurns(since), collectSlackTurns(since)]);
  const all = [...web, ...slack];
  if (all.length === 0) return [];

  const seen = await analyzedKeys(since);
  if (!seen) return [];

  return all.filter((t) => !seen.has(turnKey(t))).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

/**
 * Même résultat que `collectTurns`, mais pensé pour être appelé souvent (la page
 * admin poll ce flux) :
 *   - côté web, on liste d'abord les ids de la fenêtre (requête légère) et on ne
 *     charge l'historique complet QUE des jobs pas encore jugés. Recharger tous
 *     les `input_messages` de la fenêtre coûte plusieurs secondes.
 *   - `userReply` n'est pas renseigné : il ne sert qu'au juge, pas à l'affichage.
 * Ne pas l'utiliser pour alimenter l'analyse LLM, qui a besoin de `userReply`.
 */
export async function collectPendingTurns(opts: { sinceDays: number }): Promise<RagTurn[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();

  const [seen, jobIds, threads] = await Promise.all([
    analyzedKeys(since),
    listWebJobIds(since),
    fetchSlackThreads(since),
  ]);
  if (!seen) return [];

  const pendingJobIds = jobIds.filter(
    (id) => !seen.has(turnKey({ source: "web", sourceId: id, turnIndex: 0 })),
  );

  const slack = threads.flatMap(turnsFromThread).filter((t) => !seen.has(turnKey(t)));
  const web = await fetchWebTurnsByIds(pendingJobIds);

  return [...web, ...slack].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

/** Ids des tours web de la fenêtre, sans charger leur historique. */
async function listWebJobIds(since: string): Promise<string[]> {
  const { data, error } = await db
    .from("chat_jobs")
    .select("id")
    .eq("status", "done")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("[rag-insights/collect] chat_jobs id query failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.id as string);
}

async function fetchWebTurnsByIds(ids: string[]): Promise<RagTurn[]> {
  if (ids.length === 0) return [];

  const { data, error } = await db
    .from("chat_jobs")
    .select("id, user_id, input_messages, final_text, sources, tool_steps, feedback, created_at")
    .in("id", ids);

  if (error) {
    console.error("[rag-insights/collect] chat_jobs payload query failed:", error.message);
    return [];
  }

  const turns: RagTurn[] = [];
  for (const job of (data ?? []) as JobRow[]) {
    const question = lastUserQuestion(job);
    const answer = (job.final_text ?? "").trim();
    if (!question || !answer) continue;
    turns.push({
      source: "web",
      sourceId: job.id,
      turnIndex: 0,
      userId: job.user_id,
      askedAt: job.created_at,
      question: truncate(question, MAX_QUESTION),
      answer: truncate(answer, MAX_ANSWER),
      notionPages: notionPagesOf(job.sources),
      guidesLoaded: guidesOf(job.tool_steps),
      userReply: null,
      feedback: job.feedback === "up" || job.feedback === "down" ? job.feedback : null,
    });
  }
  return turns;
}
