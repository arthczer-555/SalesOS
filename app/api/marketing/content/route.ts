import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";
import { fetchTopPages, fetchKPIs } from "@/lib/google-analytics";
import { fetchKeywords } from "@/lib/google-search-console";
import { fetchAllArticles } from "@/lib/wordpress";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

interface Recommendation {
  id: string;
  topic: string;
  targetKeyword: string;
  justification: string;
  estimatedTraffic: number;
  difficulty: "easy" | "medium" | "hard";
  priority: "high" | "medium" | "low";
  status: "recommended" | "approved" | "writing" | "published";
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
}

let analysisResult: Analysis | null = null;
let recommendations: Recommendation[] = [];
const drafts = new Map<string, Draft>();

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({
    analysis: analysisResult,
    recommendations,
    drafts: Array.from(drafts.values()),
  });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { action, recommendationId } = body;

  if (action === "analyze") {
    try {
      return await runAnalysis(user.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed" }, { status: 500 });
    }
  }

  if (action === "approve" && recommendationId) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (rec) rec.status = "approved";
    return NextResponse.json({ success: true, recommendations });
  }

  if (action === "reject" && recommendationId) {
    recommendations = recommendations.filter((r) => r.id !== recommendationId);
    return NextResponse.json({ success: true, recommendations });
  }

  if (action === "generate" && recommendationId) {
    try {
      return await runGeneration(user.id, recommendationId);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Generation failed" }, { status: 500 });
    }
  }

  if (action === "publish" && recommendationId) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (rec) rec.status = "published";
    return NextResponse.json({ success: true, recommendations });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ─── Analysis ────────────────────────────────────────────────────────────────

async function runAnalysis(userId: string) {
  // Gather data in parallel
  const [topPagesResult, keywordsResult, articlesResult] = await Promise.allSettled([
    fetchTopPages(userId, 30, 10),
    fetchKeywords(userId, 28, true),
    fetchAllArticles(100),
  ]);

  const topPages = topPagesResult.status === "fulfilled" ? topPagesResult.value : [];
  const keywords = keywordsResult.status === "fulfilled" ? keywordsResult.value : [];
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

  // ── 2. RISING TRENDS: real Search Console keywords sorted by opportunity ───
  // "Rising trend" = high impressions but not yet in top positions (still growing)
  // We pick keywords with >100 impressions and position 4-20 (opportunity zone)
  const risingTrends = keywords
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

  // ── 3. CONTENT GAPS: Claude analyzes based on real data ────────────────────
  // Build a rich prompt with real numbers and real article titles
  const topPerformersText = topPerformers.length > 0
    ? topPerformers.map((p) => `- "${p.title}" — ${p.sessions} sessions`).join("\n")
    : "GA4 data unavailable";

  const topKeywordsText = keywords.length > 0
    ? keywords.slice(0, 30).map((k) => `- "${k.keyword}" — ${k.impressions} impressions, ${k.clicks} clicks, CTR ${k.ctr}%, position ${k.position}`).join("\n")
    : "Search Console data unavailable";

  const articlesText = articles.slice(0, 50).map((a) => `- ${a.title}`).join("\n");

  const prompt = `You are a senior content strategist for Coachello, a B2B leadership coaching platform (human coaches + AI).

I have REAL data. Do NOT invent numbers or facts. Only analyze what is given.

## All published blog articles (${articles.length} articles)
${articlesText}

## Top search queries sending traffic (Google Search Console, last 28 days)
${topKeywordsText}

## Top performing pages (GA4, last 30 days)
${topPerformersText}

---

Task: identify 3 content gaps — article ideas Coachello should write but hasn't.

Criteria:
- Based on the search queries people use vs what Coachello has published
- Each gap must be a SPECIFIC article title, not a generic topic
- Justify each with data from the lists above (cite the exact numbers, e.g. "keyword X has Y impressions")
- Pick a target keyword from the Search Console list for each gap
- Also write a 2-3 sentence summary of the single biggest opportunity

Return ONLY valid JSON:
{
  "contentGaps": [
    {
      "topic": "specific article title",
      "rationale": "data-backed justification citing real numbers from the lists above",
      "targetKeyword": "exact keyword from the Search Console list"
    }
  ],
  "summary": "2-3 sentences"
}`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(userId, "claude-sonnet-4-6", message.usage.input_tokens, message.usage.output_tokens, "marketing_content_analyze");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned invalid JSON");

  const parsed = JSON.parse(jsonMatch[0]) as { contentGaps: Analysis["contentGaps"]; summary: string };

  analysisResult = {
    topPerformers,
    risingTrends,
    contentGaps: parsed.contentGaps,
    summary: parsed.summary,
    dataSources: {
      ga4: { ok: topPages.length > 0, error: ga4Error, pagesCount: topPages.length },
      searchConsole: { ok: keywords.length > 0, error: scError, keywordsCount: keywords.length },
      wordpress: { ok: articles.length > 0, error: wpError, articlesCount: articles.length },
    },
  };

  // Build recommendations from content gaps
  recommendations = parsed.contentGaps.map((gap, i) => {
    // Find matching keyword for traffic estimate
    const matchedKw = keywords.find((k) => k.keyword === gap.targetKeyword);
    const estimatedTraffic = matchedKw
      ? Math.round(matchedKw.impressions * 0.05) // assume 5% of impressions converting to clicks if we rank well
      : 0;

    return {
      id: `rec-${Date.now()}-${i}`,
      topic: gap.topic,
      targetKeyword: gap.targetKeyword,
      justification: gap.rationale,
      estimatedTraffic,
      difficulty: (["easy", "medium", "hard"] as const)[i % 3],
      priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
      status: "recommended",
    };
  });

  return NextResponse.json({
    analysis: analysisResult,
    recommendations,
  });
}

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Analyze article structure: count headings, average paragraph length,
 * detect CTA patterns, word count, key elements.
 */
function analyzeStructure(html: string): {
  wordCount: number;
  h2Count: number;
  h3Count: number;
  paragraphCount: number;
  bulletLists: number;
  tables: number;
  internalLinks: number;
  hasIntroHook: boolean;
  hasStatsOrData: boolean;
  hasCTA: boolean;
  outline: string[];
} {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = text.split(" ").filter(Boolean).length;

  const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  const h3Matches = html.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];
  const paragraphCount = (html.match(/<p[^>]*>/gi) || []).length;
  const bulletLists = (html.match(/<ul[^>]*>/gi) || []).length;
  const tables = (html.match(/<table[^>]*>/gi) || []).length;
  const internalLinks = (html.match(/href="https:\/\/coachello\.ai/gi) || []).length;

  const outline = [
    ...h2Matches.map((h) => "H2: " + h.replace(/<[^>]*>/g, "").trim()),
    ...h3Matches.map((h) => "  H3: " + h.replace(/<[^>]*>/g, "").trim()),
  ];

  const hasStatsOrData = /\d+%|\d+x|\d+ (sessions|users|ROI|coaches|managers)/i.test(text);
  const hasCTA = /book a demo|request a demo|talk to|get started|contact us|learn more/i.test(text);
  const hasIntroHook = /^[^.]{0,200}\?/.test(text.slice(0, 400)) || /\d+%/.test(text.slice(0, 500));

  return {
    wordCount,
    h2Count: h2Matches.length,
    h3Count: h3Matches.length,
    paragraphCount,
    bulletLists,
    tables,
    internalLinks,
    hasIntroHook,
    hasStatsOrData,
    hasCTA,
    outline,
  };
}

async function runGeneration(userId: string, recommendationId: string) {
  const rec = recommendations.find((r) => r.id === recommendationId);
  if (!rec) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });

  rec.status = "writing";

  // ── Fetch all articles (we'll pick the top performers) ─────────────────────
  const allArticles = await fetchAllArticles(100);
  if (allArticles.length === 0) {
    return NextResponse.json({ error: "No WordPress articles available as style reference" }, { status: 400 });
  }

  // ── Fetch GA4 top pages to identify BEST performing articles ───────────────
  let topPerformingSlugs: string[] = [];
  let ga4Available = false;
  try {
    const topPages = await fetchTopPages(userId, 30, 20);
    topPerformingSlugs = topPages
      .map((p) => p.path.replace(/^\/blog\//, "").replace(/\/$/, ""))
      .filter(Boolean);
    ga4Available = topPages.length > 0;
  } catch {
    // GA4 unavailable — fall back to most recent
  }

  // ── Pick style reference articles: top 3 by GA4 sessions, fallback to recent ─
  let styleArticles = topPerformingSlugs.length > 0
    ? topPerformingSlugs
        .map((slug) => allArticles.find((a) => a.slug === slug))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .slice(0, 3)
    : [];

  if (styleArticles.length < 3) {
    // Fill with most recent if we don't have enough
    const existing = new Set(styleArticles.map((a) => a.id));
    for (const a of allArticles) {
      if (styleArticles.length >= 3) break;
      if (!existing.has(a.id)) styleArticles.push(a);
    }
  }

  // ── Fetch real metrics for the target keyword ──────────────────────────────
  let targetKeywordMetrics: { impressions: number; clicks: number; ctr: number; position: number } | null = null;
  let searchConsoleAvailable = false;
  try {
    const keywords = await fetchKeywords(userId, 28, false);
    searchConsoleAvailable = keywords.length > 0;
    const matched = keywords.find((k) => k.keyword.toLowerCase() === rec.targetKeyword.toLowerCase());
    if (matched) {
      targetKeywordMetrics = {
        impressions: matched.impressions,
        clicks: matched.clicks,
        ctr: matched.ctr,
        position: matched.position,
      };
    }
  } catch {
    // Search Console unavailable
  }

  // ── Build structure analysis for each reference article ────────────────────
  const structureAnalyses = styleArticles.map((a) => {
    const s = analyzeStructure(a.contentHtml);
    return {
      title: a.title,
      slug: a.slug,
      structure: s,
    };
  });

  // Average structure across top articles
  const avgStructure = {
    wordCount: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.wordCount, 0) / Math.max(structureAnalyses.length, 1)),
    h2Count: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.h2Count, 0) / Math.max(structureAnalyses.length, 1)),
    h3Count: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.h3Count, 0) / Math.max(structureAnalyses.length, 1)),
    paragraphCount: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.paragraphCount, 0) / Math.max(structureAnalyses.length, 1)),
    bulletLists: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.bulletLists, 0) / Math.max(structureAnalyses.length, 1)),
    tables: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.tables, 0) / Math.max(structureAnalyses.length, 1)),
    internalLinks: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.internalLinks, 0) / Math.max(structureAnalyses.length, 1)),
  };

  // ── Build prompt sections ──────────────────────────────────────────────────
  const styleReferenceText = styleArticles.slice(0, 3).map((a, i) => {
    const struct = structureAnalyses[i];
    return `### Reference article #${i + 1}: ${a.title}
URL: ${a.link}
Published: ${new Date(a.date).toLocaleDateString("en-US")}
Structure: ${struct.structure.wordCount} words, ${struct.structure.h2Count} H2 sections, ${struct.structure.h3Count} H3 subsections, ${struct.structure.paragraphCount} paragraphs, ${struct.structure.bulletLists} bullet lists, ${struct.structure.tables} table(s), ${struct.structure.internalLinks} internal links.
Outline:
${struct.structure.outline.join("\n")}

Full content:
${a.contentText.slice(0, 3500)}
`;
  }).join("\n---\n\n");

  const availableForLinking = allArticles.slice(0, 30).map((a) => `- "${a.title}" → ${a.link}`).join("\n");

  const metricsSection = targetKeywordMetrics
    ? `## REAL Search Console data for the target keyword "${rec.targetKeyword}" (last 28 days)
- Impressions: ${targetKeywordMetrics.impressions}
- Clicks: ${targetKeywordMetrics.clicks}
- CTR: ${targetKeywordMetrics.ctr}%
- Current ranking position: ${targetKeywordMetrics.position}

This means the keyword already has real search demand. Your article must target this exact keyword and satisfy the search intent behind it.`
    : searchConsoleAvailable
      ? `## Note: "${rec.targetKeyword}" is a priority keyword but has no Search Console history yet — it's an emerging opportunity.`
      : `## Note: Search Console data unavailable — optimize for the target keyword based on topic relevance.`;

  const prompt = `You are Coachello's senior content writer. Write a NEW blog article in two languages (French + English).

## Topic
${rec.topic}

## Target keyword
${rec.targetKeyword}

## Data-driven justification for this article (from real analytics)
${rec.justification}

${metricsSection}

## Source of style reference
${ga4Available
  ? `The 3 articles below are Coachello's TOP-PERFORMING articles by GA4 sessions (last 30 days). Match their structure, tone, and voice precisely — this is what works with Coachello's audience.`
  : `The 3 articles below are recent Coachello articles. Match their structure, tone, and voice.`}

## Reference articles with structure analysis

${styleReferenceText}

## Structural baseline (average of the top articles — your article should match these numbers within ±15%)
- Target word count: ~${avgStructure.wordCount} words (per language)
- H2 sections: ~${avgStructure.h2Count}
- H3 subsections: ~${avgStructure.h3Count}
- Paragraphs: ~${avgStructure.paragraphCount}
- Bullet lists: ~${avgStructure.bulletLists}
- Tables: ~${avgStructure.tables}
- Internal links: ~${avgStructure.internalLinks}

## All Coachello articles — pick 3-5 for internal links per language
${availableForLinking}

---

STRICT RULES:
1. Write the complete article in BOTH French and English. Each language must be independently written (not translated) — adapt to the audience.
2. Follow the structure pattern of the reference articles: same use of H2/H3 heading density, same paragraph rhythm, same presence of bullet lists and tables if the top articles use them.
3. Match the tone, voice, and opening style of the top references (e.g., do they open with a question? A stat? A provocative statement?).
4. Use ONLY real numbers. If you cite a statistic, source it from ICF, PwC/ICF study, Gartner, McKinsey, HBR, BCG, or Deloitte — never invent %. If you don't have a verifiable number, use a qualitative statement instead.
5. Never mention "one in X companies", fake ROI figures, or fabricated study names. Stick to well-known, verifiable industry references.
6. Include 3-5 internal links per language, picked from the "All Coachello articles" list above. Pick ones that are topically relevant to your article's sections.
7. End with a CTA section pointing to Coachello (similar pattern to references).
8. Output valid HTML only for the content (use <h2>, <h3>, <p>, <ul><li>, <table>, <strong>, <a href="...">), no <html>/<body> wrappers.

Return ONLY valid JSON, no markdown, no preamble:
{
  "content": {
    "fr": "<h2>...</h2><p>...</p>...",
    "en": "<h2>...</h2><p>...</p>..."
  },
  "wordpressFormat": {
    "fr": {"category": "...", "tags": ["..."], "excerpt": "... (max 155 chars)", "slug": "url-slug-fr"},
    "en": {"category": "...", "tags": ["..."], "excerpt": "... (max 155 chars)", "slug": "url-slug-en"}
  },
  "internalLinks": {
    "fr": [{"anchorText": "...", "targetArticleTitle": "...", "targetUrl": "..."}],
    "en": [{"anchorText": "...", "targetArticleTitle": "...", "targetUrl": "..."}]
  },
  "styleMatchScore": 85,
  "structureNotes": "1 sentence explaining which reference articles you modeled on and why"
}`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(userId, "claude-sonnet-4-6", message.usage.input_tokens, message.usage.output_tokens, "marketing_content_generate");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned invalid JSON");

  const parsed = JSON.parse(jsonMatch[0]);
  const draft: Draft = {
    recommendationId: rec.id,
    content: parsed.content,
    wordpressFormat: parsed.wordpressFormat,
    styleMatchScore: parsed.styleMatchScore || 80,
    internalLinks: parsed.internalLinks || { fr: [], en: [] },
  };

  drafts.set(rec.id, draft);

  return NextResponse.json({
    success: true,
    draft,
    recommendations,
  });
}
