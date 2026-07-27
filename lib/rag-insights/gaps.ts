/**
 * Trous dans la raquette : croise les questions ratées avec ce que contient
 * réellement la base Notion, et propose des enrichissements de pages ou des
 * pages à créer.
 *
 * Contexte donné au modèle :
 *   - les tours de connaissance ratés (missing_info / wrong / partial)
 *   - le registre des pages du pack notion_knowledge (AGENT_GUIDE.md du repo
 *     Coachello.RAG, via le guide-loader)
 *   - l'arbre racine live de 🧭 DATABASE (les sections réellement présentes)
 *
 * Le modèle ne décide RIEN sur le contenu de Coachello : il rapproche des
 * questions ratées d'un sommaire, il ne répond jamais aux questions lui-même.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { loadGuideBundle } from "@/lib/chat/rag/guide-loader";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { NO_EM_DASH_RULE_EN } from "@/lib/no-em-dash";
import { isNotionConfigured } from "@/lib/notion/client";
import { listChildPages } from "@/lib/notion/read";
import { computeStats, failingTurns } from "./stats";
import type { RagAnalysisRow, RagGapReport } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

const FALLBACK_MODEL = "claude-sonnet-4-6";
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID ?? "3911c2f23b0e81368321d2f8a4ea524e";
const MAX_FAILING = 60;

const gapTool: Anthropic.Tool = {
  name: "emit_gap_report",
  description: "Emits the knowledge base gap report.",
  input_schema: {
    type: "object" as const,
    properties: {
      gaps: {
        type: "array",
        description: "Themes where the knowledge base failed to answer, most important first. Max 8.",
        items: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short title of the missing topic" },
            question_count: { type: "number" },
            sample_questions: { type: "array", items: { type: "string" }, description: "Up to 3 real questions, verbatim" },
            existing_pages: {
              type: "array",
              description: "Pages of the knowledge base that already cover the area and should have answered",
              items: {
                type: "object",
                properties: { title: { type: "string" }, url: { type: "string" } },
                required: ["title"],
              },
            },
            missing: { type: "string", description: "What content is actually missing, concretely" },
            action: { type: "string", enum: ["enrich_page", "create_page"] },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["theme", "question_count", "sample_questions", "existing_pages", "missing", "action", "priority"],
        },
      },
      new_pages: {
        type: "array",
        description: "Notion pages worth creating. Max 5. Only when an existing page cannot reasonably absorb the content.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            parent_section: { type: "string", description: "Existing section of the tree it should live under" },
            outline: { type: "array", items: { type: "string" }, description: "3 to 6 bullet headings" },
            why: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["title", "parent_section", "outline", "why", "priority"],
        },
      },
      quick_wins: {
        type: "array",
        description: "Cheap fixes: a page to clarify, a wrong route in the registry, an ambiguous title. Max 5.",
        items: { type: "string" },
      },
    },
    required: ["gaps", "new_pages", "quick_wins"],
  },
};

function renderFailing(rows: RagAnalysisRow[]): string {
  return rows
    .slice(0, MAX_FAILING)
    .map((r, i) => {
      const pages = r.notion_pages?.map((p) => p.title).join(" ; ") || "(none)";
      return [
        `[${i}] ${r.asked_at.slice(0, 10)} | ${r.category ?? "other"} | verdict ${r.verdict} | satisfaction ${r.satisfaction ?? "n/a"}`,
        `Q: ${r.question}`,
        `What the bot answered: ${r.answer_summary ?? "(not summarized)"}`,
        `What went wrong: ${r.issue ?? "(not specified)"}`,
        `Missing from Notion: ${r.gap_summary ?? "(not specified)"}`,
        `Pages read: ${pages}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function notionTreeContext(): Promise<string> {
  if (!isNotionConfigured()) return "(Notion integration not configured)";
  try {
    const children = await listChildPages(ROOT_PAGE_ID);
    if (children.length === 0) return "(empty root)";
    return children.map((c) => `- ${c.title} (${c.kind})`).join("\n");
  } catch (e) {
    console.warn("[rag-insights/gaps] notion tree failed:", e instanceof Error ? e.message : e);
    return "(Notion tree unavailable)";
  }
}

async function registryContext(): Promise<string> {
  try {
    const bundle = await loadGuideBundle();
    const pack = bundle.packs.get("notion_knowledge");
    if (!pack) return "(notion_knowledge pack unavailable)";
    // Le registre suffit : on cape pour ne pas noyer le prompt.
    return pack.body.slice(0, 12_000);
  } catch (e) {
    console.warn("[rag-insights/gaps] guide bundle failed:", e instanceof Error ? e.message : e);
    return "(knowledge guide unavailable)";
  }
}

/**
 * Construit le rapport de gaps sur la fenêtre et le persiste dans
 * rag_gap_reports. Retourne null si rien d'exploitable.
 */
export async function buildGapReport(args: {
  rows: RagAnalysisRow[];
  periodStart: string;
  periodEnd: string;
}): Promise<{ id: string; payload: RagGapReport } | null> {
  const { rows, periodStart, periodEnd } = args;
  const stats = computeStats(rows);

  const failing = failingTurns(rows.filter((r) => r.is_knowledge));
  if (failing.length === 0 || !process.env.ANTHROPIC_API_KEY) {
    // Pas de trou détecté (ou pas de clé) : on persiste quand même les stats
    // pour que le recap et la page aient une photo de la fenêtre.
    const payload: RagGapReport = { gaps: [], new_pages: [], quick_wins: [], stats };
    const { data } = await db
      .from("rag_gap_reports")
      .insert({ period_start: periodStart, period_end: periodEnd, payload })
      .select("id")
      .single();
    return data ? { id: data.id as string, payload } : null;
  }

  const model = await getModelPreference("rag_gaps", FALLBACK_MODEL);
  const [registry, tree] = await Promise.all([registryContext(), notionTreeContext()]);

  const system = `You audit the Notion knowledge base behind CoachelloGPT, the internal assistant of Coachello (B2B human coaching programs).

You receive questions the assistant failed to answer well, plus the current structure of the knowledge base. Your job is to tell the team what to write, not to answer the questions.

Rules:
- Group the failures into themes. A theme with a single question is only worth reporting if the question is clearly important.
- Prefer enrich_page over create_page: creating a page is a real cost, and a scattered base is worse than a dense one.
- existing_pages must only contain pages that really appear in the registry or the tree below. Never invent a page.
- missing must describe the content to write, concretely (for example "cross-border VAT rules and invoicing entity per country"), not a restatement of the question.
- sample_questions must be copied verbatim from the failures, in their original language.
- Set priority from how often the topic comes up and how costly a wrong answer is in front of a prospect.
- quick_wins are cheap structural fixes: a badly routed entry in the registry, an ambiguous page title, information buried in a sub-page.
- Write everything in English except the verbatim questions.

${NO_EM_DASH_RULE_EN}`;

  const client = anthropicClient({ timeout: 180_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 6000,
        system,
        messages: [
          {
            role: "user",
            content: [
              `Period: ${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)}.`,
              `${stats.total} questions analyzed, ${stats.knowledge} of them knowledge questions, average satisfaction ${stats.avgSatisfaction ?? "n/a"}.`,
              ``,
              `=== ROOT SECTIONS OF THE NOTION KNOWLEDGE BASE ===`,
              tree,
              ``,
              `=== PAGE REGISTRY (notion_knowledge guide) ===`,
              registry,
              ``,
              `=== FAILED KNOWLEDGE QUESTIONS (${Math.min(failing.length, MAX_FAILING)} of ${failing.length}) ===`,
              renderFailing(failing),
            ].join("\n"),
          },
        ],
        tools: [gapTool],
        tool_choice: { type: "tool" as const, name: "emit_gap_report" },
      }),
    { label: "rag-insights/gaps" },
  );

  logUsage(null, model, msg.usage.input_tokens, msg.usage.output_tokens, "rag_gaps");

  const block = msg.content.find((b) => b.type === "tool_use");
  const parsed = block && "input" in block ? (block.input as Partial<RagGapReport>) : {};

  const payload: RagGapReport = {
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 8) : [],
    new_pages: Array.isArray(parsed.new_pages) ? parsed.new_pages.slice(0, 5) : [],
    quick_wins: Array.isArray(parsed.quick_wins) ? parsed.quick_wins.slice(0, 5) : [],
    stats,
  };

  const { data, error } = await db
    .from("rag_gap_reports")
    .insert({ period_start: periodStart, period_end: periodEnd, payload })
    .select("id")
    .single();

  if (error) {
    console.error("[rag-insights/gaps] insert failed:", error.message);
    return null;
  }
  return { id: data.id as string, payload };
}
