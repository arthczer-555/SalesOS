import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { fetchTopPages } from "@/lib/google-analytics";
import { fetchKeywords } from "@/lib/google-search-console";
import { fetchAllArticles, hydrateArticleBodies } from "@/lib/wordpress";
import type { ArticleDraft, ArticleRecommendation, InternalLink } from "@/lib/marketing-types";

const REC_SELECT =
  "id, user_id, topic, target_keyword, justification, estimated_traffic, difficulty, priority, status, relevance_score, relevance_reason, created_at";

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

function mapDbRec(r: DbRec): ArticleRecommendation {
  return {
    id: r.id,
    topic: r.topic,
    targetKeyword: r.target_keyword,
    justification: r.justification ?? "",
    estimatedTraffic: r.estimated_traffic ?? 0,
    difficulty: (r.difficulty as ArticleRecommendation["difficulty"]) ?? "medium",
    priority: (r.priority as ArticleRecommendation["priority"]) ?? "medium",
    status: (r.status as ArticleRecommendation["status"]) ?? "recommended",
    relevanceScore: r.relevance_score ?? undefined,
    relevanceReason: r.relevance_reason ?? undefined,
    createdAt: r.created_at,
  };
}

async function getRec(recId: string): Promise<ArticleRecommendation | null> {
  const { data } = await db
    .from("marketing_content_recommendations")
    .select(REC_SELECT)
    .eq("id", recId)
    .maybeSingle();
  if (!data) return null;
  return mapDbRec(data as DbRec);
}

async function updateRecStatus(recId: string, status: ArticleRecommendation["status"]): Promise<void> {
  await db
    .from("marketing_content_recommendations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", recId);
}

async function deleteDraftsForRec(recId: string): Promise<void> {
  await db
    .from("marketing_content_drafts")
    .delete()
    .eq("recommendation_id", recId);
}

async function saveDraft(userId: string, rec: ArticleRecommendation, draft: ArticleDraft): Promise<void> {
  await db.from("marketing_content_drafts").insert({
    user_id: userId,
    recommendation_id: rec.id,
    topic: rec.topic,
    target_keyword: rec.targetKeyword,
    content: draft.content,
    wordpress_format: draft.wordpressFormat,
    internal_links: draft.internalLinks,
    style_match_score: draft.styleMatchScore,
  });
}

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

export type RunArticleGenerationResult =
  | { ok: true; draft: ArticleDraft }
  | { ok: false; status: number; error: string };

export async function runArticleGeneration(
  userId: string,
  recommendationId: string,
): Promise<RunArticleGenerationResult> {
  const rec = await getRec(recommendationId);
  if (!rec) return { ok: false, status: 404, error: "Recommendation not found" };

  await updateRecStatus(rec.id, "writing");

  try {
    // ── Fetch all articles (we'll pick the top performers) ───────────────────
    const allArticles = await fetchAllArticles(5000);
    if (allArticles.length === 0) {
      await updateRecStatus(rec.id, "approved");
      return { ok: false, status: 400, error: "No WordPress articles available as style reference" };
    }

    // ── Fetch GA4 top pages to identify BEST performing articles ─────────────
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

    const styleArticles = topPerformingSlugs.length > 0
      ? topPerformingSlugs
          .map((slug) => allArticles.find((a) => a.slug === slug))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .slice(0, 3)
      : [];

    if (styleArticles.length < 3) {
      const existing = new Set(styleArticles.map((a) => a.id));
      for (const a of allArticles) {
        if (styleArticles.length >= 3) break;
        if (!existing.has(a.id)) styleArticles.push(a);
      }
    }

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

    await hydrateArticleBodies(styleArticles);

    const structureAnalyses = styleArticles.map((a) => {
      const s = analyzeStructure(a.contentHtml);
      return {
        title: a.title,
        slug: a.slug,
        structure: s,
      };
    });

    const avgStructure = {
      wordCount: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.wordCount, 0) / Math.max(structureAnalyses.length, 1)),
      h2Count: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.h2Count, 0) / Math.max(structureAnalyses.length, 1)),
      h3Count: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.h3Count, 0) / Math.max(structureAnalyses.length, 1)),
      paragraphCount: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.paragraphCount, 0) / Math.max(structureAnalyses.length, 1)),
      bulletLists: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.bulletLists, 0) / Math.max(structureAnalyses.length, 1)),
      tables: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.tables, 0) / Math.max(structureAnalyses.length, 1)),
      internalLinks: Math.round(structureAnalyses.reduce((s, a) => s + a.structure.internalLinks, 0) / Math.max(structureAnalyses.length, 1)),
    };

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

    const sharedContext = `## Topic
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

## Structural baseline (match the top articles' rhythm, but respect the HARD word/link constraints below)
- Target word count: **between 1500 and 2000 words** (HARD constraint — do not go under 1500 or over 2000)
- H2 sections: ~${avgStructure.h2Count}
- H3 subsections: ~${avgStructure.h3Count}
- Paragraphs: ~${avgStructure.paragraphCount}
- Bullet lists: ~${avgStructure.bulletLists}
- Tables: ~${avgStructure.tables}
- Internal links: **between 6 and 8** (HARD constraint — do not go under 6 or over 8)

## All Coachello articles — pick 6-8 for internal links
${availableForLinking}

---

STRICT RULES:
1. Follow the structure pattern of the reference articles: same use of H2/H3 heading density, same paragraph rhythm, same presence of bullet lists and tables.
2. Match the tone, voice, and opening style of the top references.
3. Use ONLY real numbers. If you cite a statistic, source it from ICF, PwC/ICF study, Gartner, McKinsey, HBR, BCG, or Deloitte — never invent %. If you don't have a verifiable number, use a qualitative statement.
4. Never mention "one in X companies", fake ROI figures, or fabricated study names.
5. **Word count MUST be between 1500 and 2000 words.** Count carefully. This overrides any reference-article length signal.
6. **Include between 6 and 8 internal links** picked from the "All Coachello articles" list above. Distribute them naturally across the article — do not cluster them.
7. End with a CTA section pointing to Coachello.
8. Output valid HTML only (use <h2>, <h3>, <p>, <ul><li>, <table>, <strong>, <a href="...">), no <html>/<body> wrappers.
`;

    const writeLanguageTool: Anthropic.Tool = {
      name: "write_article_language",
      description: "Writes a complete blog article in one language with WordPress metadata and internal links",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Full article HTML" },
          wordpressFormat: {
            type: "object",
            properties: {
              category: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              excerpt: { type: "string", description: "Max 155 characters" },
              slug: { type: "string" },
            },
            required: ["category", "tags", "excerpt", "slug"],
          },
          internalLinks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                anchorText: { type: "string" },
                targetArticleTitle: { type: "string" },
                targetUrl: { type: "string" },
              },
              required: ["anchorText", "targetArticleTitle", "targetUrl"],
            },
          },
        },
        required: ["content", "wordpressFormat", "internalLinks"],
      },
    };

    const client = new Anthropic();

    async function writeLanguage(lang: "fr" | "en"): Promise<{
      content: string;
      wordpressFormat: { category: string; tags: string[]; excerpt: string; slug: string };
      internalLinks: InternalLink[];
    }> {
      const langInstruction = lang === "fr"
        ? "Write this article in French, adapted to a French-speaking HR/L&D audience. Do not translate — write natively for this audience."
        : "Write this article in English, adapted to an English-speaking HR/L&D audience. Do not translate — write natively for this audience.";

      const langPrompt = `You are Coachello's senior content writer. Write a NEW blog article in ${lang === "fr" ? "French" : "English"}.

${langInstruction}

${sharedContext}

Call the \`write_article_language\` tool with your complete output.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        tools: [writeLanguageTool],
        tool_choice: { type: "tool", name: "write_article_language" },
        messages: [{ role: "user", content: langPrompt }],
      });

      logUsage(userId, "claude-sonnet-4-6", response.usage.input_tokens, response.usage.output_tokens, `marketing_content_generate_${lang}`);

      if (response.stop_reason === "max_tokens") {
        throw new Error(`${lang.toUpperCase()}: Claude hit max_tokens limit. Try a shorter topic or reduce reference article length.`);
      }

      const toolUse = response.content.find((c) => c.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new Error(`${lang.toUpperCase()}: no tool_use block. stop_reason: ${response.stop_reason}`);
      }

      const out = toolUse.input as {
        content: string;
        wordpressFormat: { category: string; tags: string[]; excerpt: string; slug: string };
        internalLinks: InternalLink[];
      };

      if (!out.content || out.content.length < 100) {
        throw new Error(`${lang.toUpperCase()}: content too short (${out.content?.length || 0} chars). stop_reason: ${response.stop_reason}`);
      }

      return out;
    }

    const [frResult, enResult] = await Promise.all([writeLanguage("fr"), writeLanguage("en")]);

    const draft: ArticleDraft = {
      recommendationId: rec.id,
      content: { fr: frResult.content, en: enResult.content },
      wordpressFormat: { fr: frResult.wordpressFormat, en: enResult.wordpressFormat },
      styleMatchScore: 85,
      internalLinks: { fr: frResult.internalLinks || [], en: enResult.internalLinks || [] },
    };

    await deleteDraftsForRec(rec.id);
    await saveDraft(userId, rec, draft);
    await updateRecStatus(rec.id, "approved");

    return { ok: true, draft };
  } catch (e) {
    // Failure: revert rec status so the user can retry instead of seeing it stuck in "writing".
    await updateRecStatus(rec.id, "approved");
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "Generation failed" };
  }
}
