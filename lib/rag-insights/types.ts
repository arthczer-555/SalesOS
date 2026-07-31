/**
 * Types partagés de RAG Insights (page admin /admin/rag).
 * Un "tour" = une question posée à CoachelloGPT et la réponse qu'il a donnée,
 * quelle que soit la surface (chat web ou Slack).
 */

/** Catégories fermées : le juge DOIT choisir dans cette liste (sinon "other"). */
export const RAG_CATEGORIES = [
  "pricing_offers",
  "programs_pedagogy",
  "internal_process",
  "positioning_competition",
  "client_deal",
  "prospecting",
  "marketing_content",
  "finance_admin",
  "hr",
  "product_tech",
  "other",
] as const;

export type RagCategory = (typeof RAG_CATEGORIES)[number];

export const RAG_CATEGORY_LABELS: Record<RagCategory, string> = {
  pricing_offers: "Pricing & offers",
  programs_pedagogy: "Programs & pedagogy",
  internal_process: "Internal process",
  positioning_competition: "Positioning & competition",
  client_deal: "Client & deal",
  prospecting: "Prospecting",
  marketing_content: "Marketing & content",
  finance_admin: "Finance & admin",
  hr: "HR",
  product_tech: "Product & tech",
  other: "Other",
};

export const RAG_VERDICTS = ["answered", "partial", "missing_info", "wrong", "off_scope"] as const;
export type RagVerdict = (typeof RAG_VERDICTS)[number];

export const RAG_VERDICT_LABELS: Record<RagVerdict, string> = {
  answered: "Answered",
  partial: "Partial",
  missing_info: "Missing info",
  wrong: "Wrong",
  off_scope: "Off scope",
};

export type RagSource = "web" | "slack";

/** Page Notion consultée pendant le tour (extraite de chat_jobs.sources). */
export type RagNotionPage = { title: string; url?: string };

/** Un tour brut, avant analyse. Produit par lib/rag-insights/collect.ts. */
export type RagTurn = {
  source: RagSource;
  /** chat_jobs.id (web) ou slack_chat_threads.id (Slack). */
  sourceId: string;
  /** 0 pour le web (une row = un tour), index du tour pour Slack. */
  turnIndex: number;
  userId: string | null;
  askedAt: string;
  question: string;
  answer: string;
  notionPages: RagNotionPage[];
  guidesLoaded: string[];
  /** Message du user juste après la réponse (signal implicite de satisfaction). */
  userReply: string | null;
  /** Feedback explicite 👍/👎 (web uniquement). */
  feedback: "up" | "down" | null;
};

/** Verdict produit par le juge LLM pour un tour. */
export type RagJudgement = {
  category: RagCategory;
  isKnowledge: boolean;
  verdict: RagVerdict;
  satisfaction: number;
  answerSummary: string;
  issue: string;
  gapSummary: string;
  reasoning: string;
};

/** Row de rag_question_analyses, telle que servie à l'UI. */
export type RagAnalysisRow = {
  id: string;
  source: RagSource;
  source_id: string;
  turn_index: number;
  user_id: string | null;
  asked_at: string;
  question: string;
  answer_excerpt: string | null;
  answer_summary: string | null;
  issue: string | null;
  category: RagCategory | null;
  is_knowledge: boolean;
  used_notion: boolean;
  notion_pages: RagNotionPage[];
  guides_loaded: string[];
  verdict: RagVerdict | null;
  satisfaction: number | null;
  satisfaction_basis: "explicit" | "inferred" | null;
  gap_summary: string | null;
  reasoning: string | null;
  model: string | null;
};

/**
 * Un tour vu par la page admin AVANT tout passage du juge :
 *   - "answering"  : la question vient d'être posée, la réponse s'écrit encore
 *   - "analyzing"  : la réponse est là, le juge n'a pas encore tourné dessus
 * Ces lignes sont reconstruites à la volée depuis chat_jobs / slack_chat_threads,
 * elles n'existent pas dans rag_question_analyses.
 */
export type RagPendingState = "answering" | "analyzing";

/** Une ligne du tableau Questions : analysée, ou encore en attente. */
export type RagRow = RagAnalysisRow & { pending?: RagPendingState };

/** Contenu de rag_gap_reports.payload. */
export type RagGapReport = {
  gaps: {
    theme: string;
    question_count: number;
    sample_questions: string[];
    existing_pages: { title: string; url?: string }[];
    missing: string;
    action: "enrich_page" | "create_page";
    priority: "high" | "medium" | "low";
  }[];
  new_pages: {
    title: string;
    parent_section: string;
    outline: string[];
    why: string;
    priority: "high" | "medium" | "low";
  }[];
  quick_wins: string[];
  /** Agrégats déterministes de la fenêtre, calculés hors LLM. */
  stats: RagStats;
};

export type RagStats = {
  total: number;
  web: number;
  slack: number;
  knowledge: number;
  avgSatisfaction: number | null;
  avgKnowledgeSatisfaction: number | null;
  unanswered: number;
  thumbsDown: number;
  byCategory: { category: RagCategory; count: number; avgSatisfaction: number | null }[];
};
