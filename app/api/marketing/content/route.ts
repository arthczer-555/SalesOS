import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";
import { db } from "@/lib/db";
import { fetchTopPages } from "@/lib/google-analytics";
import { fetchKeywords } from "@/lib/google-search-console";
import { fetchAllArticles } from "@/lib/wordpress";
import { classifyKeywords } from "@/lib/keyword-relevance";
import { BUSINESS_CONTEXT_PROMPT_BLOCK } from "@/lib/business-context";
import { NO_EM_DASH_RULE_EN } from "@/lib/no-em-dash";
import { runArticleGeneration } from "@/lib/marketing/generate-article";
import { getModelPreference } from "@/lib/models/get-model-preference";
import type { Keyword, KeywordRelevance } from "@/lib/marketing-types";

const ANALYSIS_MODEL = "claude-haiku-4-5-20251001";

/**
 * GSC returns rows keyed by (query, page), so the same keyword can appear on
 * multiple pages. Collapse to one row per keyword: sum impressions/clicks,
 * recompute CTR, keep the best (lowest) position.
 */
function dedupeKeywords(keywords: Keyword[]): Keyword[] {
  const byKeyword = new Map<string, Keyword>();
  for (const k of keywords) {
    const key = k.keyword.trim().toLowerCase();
    const existing = byKeyword.get(key);
    if (!existing) {
      byKeyword.set(key, { ...k });
      continue;
    }
    existing.impressions += k.impressions;
    existing.clicks += k.clicks;
    existing.position = Math.min(existing.position, k.position);
    existing.ctr = existing.impressions > 0
      ? Math.round((existing.clicks / existing.impressions) * 1000) / 10
      : 0;
  }
  return Array.from(byKeyword.values());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Analysis {
  topPerformers: { title: string; sessions: number; path: string }[];
  risingTrends: { keyword: string; impressions: number; clicks: number; ctr: number; position: number }[];
  contentGaps: { topic: string; rationale: string; targetKeyword: string }[];
  summary: string;
  dataSources: {
    ga4: { ok: boolean; error?: string; pagesCount: number };
    searchConsole: { ok: boolean; error?: string; keywordsCount: number };
    wordpress: { ok: boolean; error?: string; articlesCount: number };
  };
}

interface ArticleAuthor {
  name: string | null;
  email: string;
}

interface Recommendation {
  id: string;
  topic: string;
  targetKeyword: string;
  justification: string;
  estimatedTraffic: number;
  difficulty: "easy" | "medium" | "hard";
  priority: "high" | "medium" | "low";
  status: "recommended" | "approved" | "writing" | "published";
  relevanceScore?: number;
  relevanceReason?: string;
  relevanceCategory?: "relevant" | "partial" | "irrelevant";
  createdAt?: string;
  author?: ArticleAuthor | null;
}

interface InternalLink {
  anchorText: string;
  targetArticleTitle: string;
  targetUrl: string;
}

interface Draft {
  recommendationId: string;
  content: { fr: string; en: string };
  wordpressFormat: {
    fr: { category: string; tags: string[]; excerpt: string; slug: string };
    en: { category: string; tags: string[]; excerpt: string; slug: string };
  };
  styleMatchScore: number;
  internalLinks: { fr: InternalLink[]; en: InternalLink[] };
  author?: ArticleAuthor | null;
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

async function loadAnalysis(userId: string): Promise<Analysis | null> {
  const { data } = await db
    .from("marketing_content_analysis")
    .select("analysis")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.analysis as Analysis) ?? null;
}

async function saveAnalysis(userId: string, analysis: Analysis): Promise<void> {
  await db
    .from("marketing_content_analysis")
    .upsert({ user_id: userId, analysis, created_at: new Date().toISOString() }, { onConflict: "user_id" });
}

interface DbRec {
  id: string;
  user_id: string;
  topic: string;
  target_keyword: string;
  justification: string | null;
  estimated_traffic: number | null;
  difficulty: string | null;
  priority: string | null;
  status: string;
  relevance_score: number | null;
  relevance_reason: string | null;
  created_at: string;
}

const REC_SELECT =
  "id, user_id, topic, target_keyword, justification, estimated_traffic, difficulty, priority, status, relevance_score, relevance_reason, created_at";

async function fetchAuthors(userIds: string[]): Promise<Map<string, ArticleAuthor>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data } = await db.from("users").select("id, name, email").in("id", unique);
  const m = new Map<string, ArticleAuthor>();
  for (const u of (data ?? []) as { id: string; name: string | null; email: string }[]) {
    m.set(u.id, { name: u.name, email: u.email });
  }
  return m;
}

function mapDbRec(r: DbRec): Recommendation {
  return {
    id: r.id,
    topic: r.topic,
    targetKeyword: r.target_keyword,
    justification: r.justification ?? "",
    estimatedTraffic: r.estimated_traffic ?? 0,
    difficulty: (r.difficulty as Recommendation["difficulty"]) ?? "medium",
    priority: (r.priority as Recommendation["priority"]) ?? "medium",
    status: (r.status as Recommendation["status"]) ?? "recommended",
    relevanceScore: r.relevance_score ?? undefined,
    relevanceReason: r.relevance_reason ?? undefined,
    createdAt: r.created_at,
  };
}

async function loadRecommendations(): Promise<Recommendation[]> {
  // Global read: all users see all recommendations across the team.
  const { data } = await db
    .from("marketing_content_recommendations")
    .select(REC_SELECT + ", updated_at")
    .order("created_at", { ascending: false });

  const rows = (data as (DbRec & { updated_at: string | null })[] | null) ?? [];

  // Safety net: revert recs stuck in "writing" beyond the BG function's 15min
  // cap. The lib's try/catch reverts on failure, but a hard kill (OOM, Netlify
  // timeout) can leave a rec stranded. Without this, the client polling loop
  // would spin forever on those rows.
  const STALE_MS = 15 * 60 * 1000;
  const now = Date.now();
  const staleIds = rows
    .filter((r) => r.status === "writing" && r.updated_at && (now - new Date(r.updated_at).getTime()) > STALE_MS)
    .map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .from("marketing_content_recommendations")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .in("id", staleIds);
    for (const r of rows) if (staleIds.includes(r.id)) r.status = "approved";
  }

  const authors = await fetchAuthors(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    ...mapDbRec(r),
    createdAt: r.created_at,
    author: authors.get(r.user_id) ?? null,
  }));
}

async function saveRecommendations(userId: string, recs: Recommendation[]): Promise<Recommendation[]> {
  // Delete old pending ones (keep approved/published)
  await db
    .from("marketing_content_recommendations")
    .delete()
    .eq("user_id", userId)
    .in("status", ["recommended"]);

  if (recs.length === 0) return [];

  const rows = recs.map((r) => ({
    user_id: userId,
    topic: r.topic,
    target_keyword: r.targetKeyword,
    justification: r.justification,
    estimated_traffic: r.estimatedTraffic,
    difficulty: r.difficulty,
    priority: r.priority,
    status: r.status,
    relevance_score: r.relevanceScore ?? null,
    relevance_reason: r.relevanceReason ?? null,
  }));

  const { data } = await db
    .from("marketing_content_recommendations")
    .insert(rows)
    .select(REC_SELECT);

  return ((data as DbRec[] | null) ?? []).map(mapDbRec);
}

async function updateRecStatus(recId: string, status: Recommendation["status"]): Promise<void> {
  // Writes are global (team-wide): any authenticated user can transition status.
  await db
    .from("marketing_content_recommendations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", recId);
}

async function deleteRec(recId: string): Promise<void> {
  await db
    .from("marketing_content_recommendations")
    .delete()
    .eq("id", recId);
}

async function deleteDraftsForRec(recId: string): Promise<void> {
  await db
    .from("marketing_content_drafts")
    .delete()
    .eq("recommendation_id", recId);
}

async function getRec(recId: string): Promise<Recommendation | null> {
  const { data } = await db
    .from("marketing_content_recommendations")
    .select(REC_SELECT)
    .eq("id", recId)
    .maybeSingle();
  if (!data) return null;
  return mapDbRec(data as DbRec);
}

interface DbDraft {
  user_id: string;
  recommendation_id: string | null;
  content: Draft["content"];
  wordpress_format: Draft["wordpressFormat"];
  internal_links: Draft["internalLinks"] | null;
  style_match_score: number | null;
}

async function loadDrafts(): Promise<Draft[]> {
  // Global read: drafts from all users.
  const { data } = await db
    .from("marketing_content_drafts")
    .select("user_id, recommendation_id, content, wordpress_format, internal_links, style_match_score")
    .order("created_at", { ascending: false });

  const rows = (data as DbDraft[] | null) ?? [];
  const authors = await fetchAuthors(rows.map((d) => d.user_id));
  return rows.map((d) => ({
    recommendationId: d.recommendation_id ?? "",
    content: d.content,
    wordpressFormat: d.wordpress_format,
    internalLinks: d.internal_links ?? { fr: [], en: [] },
    styleMatchScore: d.style_match_score ?? 0,
    author: authors.get(d.user_id) ?? null,
  }));
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [analysis, recommendations, drafts] = await Promise.all([
    loadAnalysis(user.id),
    loadRecommendations(),
    loadDrafts(),
  ]);

  return NextResponse.json({ analysis, recommendations, drafts });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { action, recommendationId } = body;

  if ((action === "analyze" || action === "write_article" || action === "suggest_theme" || action === "generate") && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Anthropic API key not configured. Set ANTHROPIC_API_KEY in your environment to use the Content Factory." },
      { status: 503 },
    );
  }

  if (action === "analyze") {
    try {
      return await runAnalysis(user.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed" }, { status: 500 });
    }
  }

  if (action === "write_article") {
    const subject = (body.subject || "").toString().trim();
    if (!subject) return NextResponse.json({ error: "Article subject is required" }, { status: 400 });
    try {
      const rec = await createArticleFromSubject(user.id, subject);
      const recs = await loadRecommendations();
      return NextResponse.json({ success: true, recommendation: rec, recommendations: recs });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create article" }, { status: 500 });
    }
  }

  if (action === "suggest_theme") {
    const theme = (body.theme || "").toString().trim();
    if (!theme) return NextResponse.json({ error: "Theme is required" }, { status: 400 });
    try {
      return await runThemeSuggestion(user.id, theme);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Theme suggestion failed" }, { status: 500 });
    }
  }

  if (action === "approve" && recommendationId) {
    await updateRecStatus(recommendationId, "approved");
    const recs = await loadRecommendations();
    return NextResponse.json({ success: true, recommendations: recs });
  }

  if (action === "reject" && recommendationId) {
    await deleteRec(recommendationId);
    const recs = await loadRecommendations();
    return NextResponse.json({ success: true, recommendations: recs });
  }

  if (action === "delete" && recommendationId) {
    await deleteDraftsForRec(recommendationId);
    await deleteRec(recommendationId);
    const [recs, drafts] = await Promise.all([
      loadRecommendations(),
      loadDrafts(),
    ]);
    return NextResponse.json({ success: true, recommendations: recs, drafts });
  }

  // Drop the generated draft and put the recommendation back to "approved" so
  // the user can rewrite without losing the recommendation itself.
  if (action === "delete_draft" && recommendationId) {
    await deleteDraftsForRec(recommendationId);
    await updateRecStatus(recommendationId, "approved");
    const [recs, drafts] = await Promise.all([
      loadRecommendations(),
      loadDrafts(),
    ]);
    return NextResponse.json({ success: true, recommendations: recs, drafts });
  }

  if (action === "generate" && recommendationId) {
    return await triggerGeneration(req, user.id, recommendationId);
  }

  if (action === "publish" && recommendationId) {
    await updateRecStatus(recommendationId, "published");
    const recs = await loadRecommendations();
    return NextResponse.json({ success: true, recommendations: recs });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ─── Analysis ────────────────────────────────────────────────────────────────

async function runAnalysis(userId: string) {
  // Gather data in parallel
  const [topPagesResult, keywordsResult, articlesResult] = await Promise.allSettled([
    fetchTopPages(userId, 30, 10),
    fetchKeywords(userId, 28, true),
    fetchAllArticles(5000),
  ]);

  const topPages = topPagesResult.status === "fulfilled" ? topPagesResult.value : [];
  const rawKeywords = keywordsResult.status === "fulfilled" ? keywordsResult.value : [];
  const keywords = dedupeKeywords(rawKeywords);
  const articles = articlesResult.status === "fulfilled" ? articlesResult.value : [];

  const ga4Error = topPagesResult.status === "rejected"
    ? (topPagesResult.reason?.message || String(topPagesResult.reason))
    : undefined;
  const scError = keywordsResult.status === "rejected"
    ? (keywordsResult.reason?.message || String(keywordsResult.reason))
    : undefined;
  const wpError = articlesResult.status === "rejected"
    ? (articlesResult.reason?.message || String(articlesResult.reason))
    : undefined;

  // Need at least WordPress + one of GA4 or Search Console
  if (articles.length === 0) {
    return NextResponse.json({
      error: "Cannot analyze: WordPress articles unavailable. " + (wpError || ""),
    }, { status: 400 });
  }
  if (topPages.length === 0 && keywords.length === 0) {
    return NextResponse.json({
      error: "Cannot analyze: both GA4 and Search Console are unavailable. " + [ga4Error, scError].filter(Boolean).join(" | "),
    }, { status: 400 });
  }

  // ── 1. TOP PERFORMERS: directly from GA4, no Claude hallucination ──────────
  const topPerformers = topPages.slice(0, 5).map((p) => ({
    title: p.title || p.path,
    sessions: p.sessions,
    path: p.path,
  }));

  // ── Classify keywords by business relevance (cache-backed) ─────────────────
  // Only classify the top-impressions slice — classifying all 500 GSC rows would
  // exceed the 120s route timeout on first run. 150 is enough: we only surface
  // the top ~30 eligible downstream.
  const CLASSIFY_TOP_N = 150;
  const keywordsToClassify = [...keywords]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, CLASSIFY_TOP_N);
  const relevanceMap = keywordsToClassify.length > 0
    ? await classifyKeywords(userId, keywordsToClassify)
    : new Map<string, KeywordRelevance>();
  const relOf = (kw: string) => relevanceMap.get(kw.trim().toLowerCase());
  const isEligible = (rel: KeywordRelevance | undefined) =>
    !!rel && rel.category !== "irrelevant" && rel.relevanceScore >= 35;
  const eligibleKeywords = keywordsToClassify.filter((k) => isEligible(relOf(k.keyword)));

  // ── 2. RISING TRENDS: only from business-relevant keywords ─────────────────
  const risingTrends = eligibleKeywords
    .filter((k) => k.impressions >= 50 && k.position >= 4 && k.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .map((k) => ({
      keyword: k.keyword,
      impressions: k.impressions,
      clicks: k.clicks,
      ctr: k.ctr,
      position: k.position,
    }));

  // ── 3. CONTENT GAPS: Claude proposes ideas — can pick from GSC or propose new angles ─
  const topPerformersText = topPerformers.length > 0
    ? topPerformers.map((p) => `- "${p.title}" - ${p.sessions} sessions`).join("\n")
    : "(none)";

  const topEligibleForPrompt = eligibleKeywords
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  const gscKeywordsText = topEligibleForPrompt.length > 0
    ? topEligibleForPrompt.map((k) => {
        const rel = relOf(k.keyword)!;
        return `- "${k.keyword}" - ${k.impressions} imp., pos ${k.position}, CTR ${k.ctr}% · relevance ${rel.relevanceScore}/100`;
      }).join("\n")
    : "(no relevant keywords in Search Console)";

  const articlesText = articles.slice(0, 40).map((a) => `- ${a.title}`).join("\n");

  const analysisTool: Anthropic.Tool = {
    name: "propose_content_gaps",
    description: "Propose 3 article ideas Coachello should write next, with data-driven rationale",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "2-3 sentences on the biggest content opportunity this cycle",
        },
        contentGaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "Specific article title - distinctive angle, not a banal listicle",
              },
              targetKeyword: {
                type: "string",
                description: "Target keyword. Can be from the Search Console list OR a new keyword you think Coachello should target.",
              },
              source: {
                type: "string",
                enum: ["search_console", "organic_insight"],
                description: "search_console = keyword from GSC list; organic_insight = your proposal based on business context + article patterns",
              },
              rationale: {
                type: "string",
                description: "Why this article - cite GSC numbers when from search_console; for organic_insight, explain the gap and why it extends a winning pattern",
              },
              relevanceReason: {
                type: "string",
                description: "One line on why this moves an HR/L&D buyer toward Coachello",
              },
            },
            required: ["topic", "targetKeyword", "source", "rationale", "relevanceReason"],
          },
        },
      },
      required: ["summary", "contentGaps"],
    },
  };

  const prompt = `You are Coachello's senior content strategist. Propose the 3 best next articles.

${BUSINESS_CONTEXT_PROMPT_BLOCK}

## What already works for us (GA4 top pages, 30d)
${topPerformersText}

## Already published (avoid duplicating these)
${articlesText}

## Relevant Search Console keywords (pre-filtered by business relevance)
${gscKeywordsText}

## Your job
Propose 3 article ideas. At least 1 MUST be an organic_insight (your own keyword proposal, NOT from the GSC list). The others can be from GSC or organic.

Rules:
- ${NO_EM_DASH_RULE_EN}
- Build on what already works - pick angles that extend a top-performing pattern, not random new bets
- No banal listicles, no generic "what is X" definitions, no "top 10 tips" filler
- Each article must have a distinctive angle that positions Coachello as the expert HR/L&D buyers should hire
- For search_console picks: cite the impressions/position numbers
- For organic_insight picks: name a keyword an HR buyer would actually type, and explain why it's a gap (high buyer intent + no existing Coachello article)
- Avoid duplicating already-published articles

Call \`propose_content_gaps\`.`;

  const model = await getModelPreference("marketing", ANALYSIS_MODEL);
  const client = new Anthropic();
  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [analysisTool],
    tool_choice: { type: "tool", name: "propose_content_gaps" },
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "marketing_content_analyze");

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`propose_content_gaps: no tool_use block. stop_reason=${message.stop_reason}`);
  }

  const parsed = toolUse.input as {
    summary: string;
    contentGaps: Array<{
      topic: string;
      targetKeyword: string;
      source: "search_console" | "organic_insight";
      rationale: string;
      relevanceReason: string;
    }>;
  };

  const analysis: Analysis = {
    topPerformers,
    risingTrends,
    contentGaps: parsed.contentGaps.map((g) => ({
      topic: g.topic,
      rationale: g.rationale,
      targetKeyword: g.targetKeyword,
    })),
    summary: parsed.summary,
    dataSources: {
      ga4: { ok: topPages.length > 0, error: ga4Error, pagesCount: topPages.length },
      searchConsole: { ok: keywords.length > 0, error: scError, keywordsCount: keywords.length },
      wordpress: { ok: articles.length > 0, error: wpError, articlesCount: articles.length },
    },
  };

  await saveAnalysis(userId, analysis);

  // Build recommendations from content gaps, enriched with relevance metadata
  const newRecs: Recommendation[] = parsed.contentGaps.map((gap, i) => {
    const kwLower = gap.targetKeyword.trim().toLowerCase();
    const matchedKw = keywords.find((k) => k.keyword.toLowerCase() === kwLower);
    const rel = relOf(gap.targetKeyword);
    const estimatedTraffic = matchedKw ? Math.round(matchedKw.impressions * 0.05) : 0;
    return {
      id: "",
      topic: gap.topic,
      targetKeyword: gap.targetKeyword,
      justification: gap.rationale,
      estimatedTraffic,
      difficulty: (["easy", "medium", "hard"] as const)[i % 3],
      priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
      status: "recommended",
      relevanceScore: rel?.relevanceScore,
      relevanceReason: gap.relevanceReason || rel?.reason,
      relevanceCategory: rel?.category,
    };
  });

  await saveRecommendations(userId, newRecs);
  const allRecs = await loadRecommendations();

  return NextResponse.json({ analysis, recommendations: allRecs });
}

// ─── Propose your own article ────────────────────────────────────────────────

/**
 * Turns a user's free-text article idea (e.g. "how AI role-play can help sales
 * teams") into a single approved recommendation ready for generation. A short
 * Claude call normalizes the subject into a clean title, a sensible target
 * keyword and a one-line angle; if it fails we fall back to the raw subject so
 * the article still gets written.
 */
async function createArticleFromSubject(userId: string, subject: string): Promise<Recommendation> {
  let topic = subject;
  let targetKeyword = subject;
  let justification = `Article requested directly by the team: "${subject}".`;

  try {
    const prepTool: Anthropic.Tool = {
      name: "prepare_article",
      description: "Turns a free-text article idea into a clean title, target keyword and editorial angle",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Polished, specific article title (not a vague topic)" },
          targetKeyword: { type: "string", description: "A natural SEO keyword/phrase the article should target" },
          justification: { type: "string", description: "One sentence on the editorial angle and why it matters for Coachello's B2B leadership-coaching ICP" },
        },
        required: ["title", "targetKeyword", "justification"],
      },
    };

    const prompt = `You are a senior content strategist for Coachello (B2B leadership coaching platform, human coaches + AI).

${BUSINESS_CONTEXT_PROMPT_BLOCK}

The team wants you to write an article on this subject: "${subject}"

Do NOT propose alternatives or several ideas. Stick to this exact subject and just prepare it for writing:
- Turn it into one clean, specific article TITLE (keep the user's intent, do not drift to another topic).
- Pick one natural target keyword/phrase for it.
- Write a one-sentence angle framed for Coachello's B2B leadership-coaching ICP.

## Rules
- ${NO_EM_DASH_RULE_EN}
- Stay faithful to the requested subject. Do not swap it for a "more relevant" one.

Call the \`prepare_article\` tool with your output.`;

    const model = await getModelPreference("marketing", ANALYSIS_MODEL);
    const client = new Anthropic();
    const message = await client.messages.create({
      model,
      max_tokens: 600,
      tools: [prepTool],
      tool_choice: { type: "tool", name: "prepare_article" },
      messages: [{ role: "user", content: prompt }],
    });

    logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "marketing_content_write_article");

    const toolUse = message.content.find((c) => c.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const p = toolUse.input as { title?: string; targetKeyword?: string; justification?: string };
      if (p.title?.trim()) topic = p.title.trim();
      if (p.targetKeyword?.trim()) targetKeyword = p.targetKeyword.trim();
      if (p.justification?.trim()) justification = p.justification.trim();
    }
  } catch (e) {
    // Normalization is best-effort: fall back to the raw subject so the article
    // still gets written.
    console.error("[marketing/content/write_article] prep call failed, using raw subject:", e instanceof Error ? e.message : e);
  }

  return await insertApprovedRec(userId, { topic, targetKeyword, justification });
}

/**
 * Inserts a single "approved" recommendation without touching the others (unlike
 * saveRecommendations which wipes pending "recommended" rows).
 */
async function insertApprovedRec(
  userId: string,
  rec: { topic: string; targetKeyword: string; justification: string },
): Promise<Recommendation> {
  const { data, error } = await db
    .from("marketing_content_recommendations")
    .insert({
      user_id: userId,
      topic: rec.topic,
      target_keyword: rec.targetKeyword,
      justification: rec.justification,
      estimated_traffic: 0,
      difficulty: "medium",
      priority: "high",
      status: "approved",
      relevance_score: null,
      relevance_reason: null,
    })
    .select(REC_SELECT)
    .single();

  if (error || !data) {
    throw new Error(`Failed to create article recommendation: ${error?.message ?? "no row returned"}`);
  }
  return mapDbRec(data as DbRec);
}

// ─── Theme-based suggestion ──────────────────────────────────────────────────

async function runThemeSuggestion(userId: string, theme: string) {
  // Fetch the same real data context as runAnalysis
  const [keywordsResult, articlesResult] = await Promise.allSettled([
    fetchKeywords(userId, 28, true),
    fetchAllArticles(5000),
  ]);

  const rawThemeKeywords = keywordsResult.status === "fulfilled" ? keywordsResult.value : [];
  const keywords = dedupeKeywords(rawThemeKeywords);
  const articles = articlesResult.status === "fulfilled" ? articlesResult.value : [];

  if (articles.length === 0) {
    return NextResponse.json({ error: "Cannot suggest: WordPress articles unavailable." }, { status: 400 });
  }

  // Classify + filter keywords by business relevance (top slice only to stay under route timeout)
  const CLASSIFY_TOP_N = 150;
  const keywordsToClassify = [...keywords]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, CLASSIFY_TOP_N);
  const relevanceMap = keywordsToClassify.length > 0
    ? await classifyKeywords(userId, keywordsToClassify)
    : new Map<string, KeywordRelevance>();
  const relOf = (kw: string) => relevanceMap.get(kw.trim().toLowerCase());
  const isEligible = (rel: KeywordRelevance | undefined) =>
    !!rel && rel.category !== "irrelevant" && rel.relevanceScore >= 35;
  const eligibleKeywords = keywordsToClassify
    .filter((k) => isEligible(relOf(k.keyword)))
    .sort((a, b) => b.impressions - a.impressions);

  const articlesText = articles.slice(0, 60).map((a) => `- ${a.title}`).join("\n");
  const keywordsText = eligibleKeywords.length > 0
    ? eligibleKeywords.slice(0, 50).map((k) => {
        const rel = relOf(k.keyword)!;
        return `- "${k.keyword}" - ${k.impressions} imp., ${k.clicks} clicks, CTR ${k.ctr}%, pos. ${k.position} · relevance ${rel.relevanceScore}/100 (${rel.category}): ${rel.reason}`;
      }).join("\n")
    : "No business-relevant Search Console keywords after filtering - suggest based on topic relevance and existing article gaps.";

  const themeTool: Anthropic.Tool = {
    name: "suggest_articles_on_theme",
    description: "Suggests 3-5 specific article ideas aligned with the user's theme, grounded in Coachello's real data",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-2 sentence explanation of how these suggestions fit the theme" },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Specific article title, not a generic topic" },
              targetKeyword: { type: "string", description: "Target keyword - prefer one from the filtered Search Console list if relevant, otherwise a natural keyword for the theme" },
              rationale: { type: "string", description: "Data-backed justification citing real numbers when available, or explaining how it fills a content gap" },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              relevanceScore: { type: "integer", description: "0-100 business relevance for Coachello's ICP. Reuse the provided score if the keyword is from the filtered list." },
              relevanceReason: { type: "string", description: "One line explaining the business angle for Coachello's ICP" },
            },
            required: ["topic", "targetKeyword", "rationale", "difficulty", "priority", "relevanceScore", "relevanceReason"],
          },
        },
      },
      required: ["summary", "recommendations"],
    },
  };

  const prompt = `You are a senior content strategist for Coachello (B2B leadership coaching platform, human coaches + AI).

${BUSINESS_CONTEXT_PROMPT_BLOCK}

The user wants article recommendations around this theme: "${theme}"

Generate 3-5 specific article ideas that:
1. Fit the user's theme closely - do not stray into unrelated topics
2. Complement what Coachello has already published (avoid duplicates)
3. Leverage real search demand when possible (use keywords from the filtered list)
4. Are specific article TITLES, not vague topics
5. Align with Coachello's B2B leadership-coaching ICP - reject any angle that targets consumer / wellness / job-seeker audiences

## All published Coachello articles (${articles.length} total - avoid duplicating these)
${articlesText}

## Business-relevant Search Console keywords (pre-filtered)
${keywordsText}

## Rules
- ${NO_EM_DASH_RULE_EN}
- Do NOT invent metrics. If citing a number, cite from the keywords list above.
- Each recommendation needs a data-backed rationale (keyword impressions, content gap vs existing articles, etc.)
- Target keyword should come from the filtered Search Console list when there's a relevant match
- Provide a relevanceScore (0-100) and one-line relevanceReason per recommendation
- Write in English, for a B2B HR/L&D audience

Call the \`suggest_articles_on_theme\` tool with your output.`;

  const model = await getModelPreference("marketing", ANALYSIS_MODEL);
  const client = new Anthropic();
  const message = await client.messages.create({
    model,
    max_tokens: 3000,
    tools: [themeTool],
    tool_choice: { type: "tool", name: "suggest_articles_on_theme" },
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "marketing_content_theme");

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Claude did not return a tool_use block. stop_reason: ${message.stop_reason}`);
  }

  const parsed = toolUse.input as {
    summary: string;
    recommendations: {
      topic: string;
      targetKeyword: string;
      rationale: string;
      difficulty: string;
      priority: string;
      relevanceScore: number;
      relevanceReason: string;
    }[];
  };

  // Build new recommendations and persist them (appending to existing, not replacing approved ones)
  const newRecs: Recommendation[] = parsed.recommendations.map((r) => {
    const matchedKw = keywords.find((k) => k.keyword.toLowerCase() === r.targetKeyword.toLowerCase());
    const rel = relOf(r.targetKeyword);
    const estimatedTraffic = matchedKw ? Math.round(matchedKw.impressions * 0.05) : 0;
    return {
      id: "",
      topic: r.topic,
      targetKeyword: r.targetKeyword,
      justification: r.rationale,
      estimatedTraffic,
      difficulty: (r.difficulty as Recommendation["difficulty"]) || "medium",
      priority: (r.priority as Recommendation["priority"]) || "medium",
      status: "recommended",
      relevanceScore: rel?.relevanceScore ?? r.relevanceScore,
      relevanceReason: r.relevanceReason || rel?.reason,
      relevanceCategory: rel?.category,
    };
  });

  // Insert new recs (keep existing approved/writing/published, replace only recommended)
  await saveRecommendations(userId, newRecs);
  const allRecs = await loadRecommendations();

  return NextResponse.json({
    success: true,
    summary: parsed.summary,
    recommendations: allRecs,
  });
}

// ─── Generation trigger ──────────────────────────────────────────────────────

/**
 * Generation runs as a Netlify Background Function (15 min cap) — Next.js API
 * routes on Netlify are capped at ~26-60s, which truncated parallel FR+EN
 * Sonnet calls mid-flight and made the client see an HTML timeout page parsed
 * as JSON. Pattern mirrors app/api/sales-coach/analyze/[id]/route.ts.
 */
async function triggerGeneration(req: NextRequest, userId: string, recommendationId: string): Promise<NextResponse> {
  const rec = await getRec(recommendationId);
  if (!rec) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });

  const siteUrl = req.nextUrl.origin;
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  const isDev = process.env.NODE_ENV === "development";
  const useBackground = isNetlifyEnv && !isDev;

  if (useBackground) {
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret) {
      return NextResponse.json({ error: "INTERNAL_SECRET not configured" }, { status: 500 });
    }

    // Mark optimistically so the rec shows "writing" immediately; the background
    // function will re-set it to ensure it's always reflected even if the
    // trigger fetch races the BG function start.
    await updateRecStatus(rec.id, "writing");

    try {
      const bgRes = await fetch(`${siteUrl}/.netlify/functions/marketing-generate-content-background`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ userId, recommendationId }),
        signal: AbortSignal.timeout(8000),
      });
      if (bgRes.status !== 202 && !bgRes.ok) {
        const text = await bgRes.text().catch(() => "");
        console.error(`[marketing/content/generate ${recommendationId}] bg trigger non-202/2xx (${bgRes.status}):`, text.slice(0, 200));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("aborted") && !msg.includes("timeout")) {
        console.error(`[marketing/content/generate ${recommendationId}] bg trigger failed:`, msg);
        // The trigger failed before the BG function picked up — revert the rec
        // so the client doesn't get stuck on "writing" with nothing happening.
        await updateRecStatus(rec.id, "approved");
        return NextResponse.json({ error: `Failed to enqueue generation: ${msg}` }, { status: 502 });
      }
    }
    return NextResponse.json({ queued: true, recommendationId }, { status: 202 });
  }

  // Local dev / non-Netlify: run inline.
  const result = await runArticleGeneration(userId, recommendationId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const recs = await loadRecommendations();
  return NextResponse.json({ success: true, draft: result.draft, recommendations: recs });
}

