import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";
import { db } from "@/lib/db";
import { BUSINESS_CONTEXT_PROMPT_BLOCK } from "@/lib/business-context";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { fetchLinkedInTrends, fetchWebCoachingTrends } from "@/lib/marketing/linkedin-trends";
import { runLinkedInPostGeneration } from "@/lib/marketing/generate-linkedin-post";
import type {
  LinkedInContentAnalysis,
  LinkedInPostDraft,
  LinkedInPostRecommendation,
} from "@/lib/marketing-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ANALYSIS_MODEL = "claude-haiku-4-5-20251001";

// Mots-clés de veille coaching (seed des requêtes SERP LinkedIn + web).
const COACHING_SEEDS = [
  "leadership coaching",
  "executive coaching",
  "manager development",
  "L&D coaching trends",
  "employee development coaching",
];

// ─── Types DB ────────────────────────────────────────────────────────────────

interface ArticleAuthor {
  name: string | null;
  email: string;
}

interface DbRec {
  id: string;
  user_id: string;
  topic: string;
  angle: string | null;
  target_audience: string | null;
  justification: string | null;
  priority: string | null;
  status: string;
  created_at: string;
}

const REC_SELECT = "id, user_id, topic, angle, target_audience, justification, priority, status, created_at";

function mapDbRec(r: DbRec): LinkedInPostRecommendation {
  return {
    id: r.id,
    topic: r.topic,
    angle: r.angle ?? "",
    targetAudience: r.target_audience ?? "",
    justification: r.justification ?? "",
    priority: (r.priority as LinkedInPostRecommendation["priority"]) ?? "medium",
    status: (r.status as LinkedInPostRecommendation["status"]) ?? "recommended",
    createdAt: r.created_at,
  };
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

async function loadAnalysis(userId: string): Promise<LinkedInContentAnalysis | null> {
  const { data } = await db
    .from("marketing_linkedin_analysis")
    .select("analysis")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.analysis as LinkedInContentAnalysis) ?? null;
}

async function saveAnalysis(userId: string, analysis: LinkedInContentAnalysis): Promise<void> {
  await db
    .from("marketing_linkedin_analysis")
    .upsert({ user_id: userId, analysis, created_at: new Date().toISOString() }, { onConflict: "user_id" });
}

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

async function loadRecommendations(): Promise<LinkedInPostRecommendation[]> {
  // Global read: all users see all recommendations across the team.
  const { data } = await db
    .from("marketing_linkedin_recommendations")
    .select(REC_SELECT + ", updated_at")
    .order("created_at", { ascending: false });

  const rows = (data as (DbRec & { updated_at: string | null })[] | null) ?? [];

  // Safety net: revert recs stuck in "writing" beyond the BG function's 15min cap.
  const STALE_MS = 15 * 60 * 1000;
  const now = Date.now();
  const staleIds = rows
    .filter((r) => r.status === "writing" && r.updated_at && now - new Date(r.updated_at).getTime() > STALE_MS)
    .map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .from("marketing_linkedin_recommendations")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .in("id", staleIds);
    for (const r of rows) if (staleIds.includes(r.id)) r.status = "approved";
  }

  const authors = await fetchAuthors(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...mapDbRec(r), author: authors.get(r.user_id) ?? null }));
}

async function saveRecommendations(userId: string, recs: LinkedInPostRecommendation[]): Promise<void> {
  // Replace only the user's still-pending "recommended" rows; keep the rest.
  await db
    .from("marketing_linkedin_recommendations")
    .delete()
    .eq("user_id", userId)
    .in("status", ["recommended"]);

  if (recs.length === 0) return;

  const rows = recs.map((r) => ({
    user_id: userId,
    topic: r.topic,
    angle: r.angle,
    target_audience: r.targetAudience,
    justification: r.justification,
    priority: r.priority,
    status: r.status,
  }));

  await db.from("marketing_linkedin_recommendations").insert(rows);
}

async function updateRecStatus(recId: string, status: LinkedInPostRecommendation["status"]): Promise<void> {
  await db
    .from("marketing_linkedin_recommendations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", recId);
}

async function deleteRec(recId: string): Promise<void> {
  await db.from("marketing_linkedin_recommendations").delete().eq("id", recId);
}

async function deleteDraftsForRec(recId: string): Promise<void> {
  await db.from("marketing_linkedin_drafts").delete().eq("recommendation_id", recId);
}

async function getRec(recId: string): Promise<LinkedInPostRecommendation | null> {
  const { data } = await db
    .from("marketing_linkedin_recommendations")
    .select(REC_SELECT)
    .eq("id", recId)
    .maybeSingle();
  if (!data) return null;
  return mapDbRec(data as DbRec);
}

interface DbDraft {
  user_id: string;
  recommendation_id: string | null;
  topic: string;
  posts: LinkedInPostDraft["posts"];
  inspiration: LinkedInPostDraft["inspiration"] | null;
}

async function loadDrafts(): Promise<LinkedInPostDraft[]> {
  const { data } = await db
    .from("marketing_linkedin_drafts")
    .select("user_id, recommendation_id, topic, posts, inspiration")
    .order("created_at", { ascending: false });

  const rows = (data as DbDraft[] | null) ?? [];
  const authors = await fetchAuthors(rows.map((d) => d.user_id));
  return rows.map((d) => ({
    recommendationId: d.recommendation_id ?? "",
    topic: d.topic,
    posts: d.posts ?? [],
    inspiration: d.inspiration ?? [],
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

  if ((action === "analyze" || action === "suggest_theme" || action === "generate") && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Anthropic API key not configured. Set ANTHROPIC_API_KEY to use the LinkedIn factory." },
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

  if (action === "suggest_theme") {
    const theme = (body.theme || "").toString().trim();
    if (!theme) return NextResponse.json({ error: "Theme is required" }, { status: 400 });
    try {
      return await runAnalysis(user.id, theme);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Theme suggestion failed" }, { status: 500 });
    }
  }

  if (action === "approve" && recommendationId) {
    await updateRecStatus(recommendationId, "approved");
    return NextResponse.json({ success: true, recommendations: await loadRecommendations() });
  }

  if (action === "reject" && recommendationId) {
    await deleteRec(recommendationId);
    return NextResponse.json({ success: true, recommendations: await loadRecommendations() });
  }

  if (action === "delete" && recommendationId) {
    await deleteDraftsForRec(recommendationId);
    await deleteRec(recommendationId);
    const [recs, drafts] = await Promise.all([loadRecommendations(), loadDrafts()]);
    return NextResponse.json({ success: true, recommendations: recs, drafts });
  }

  if (action === "delete_draft" && recommendationId) {
    await deleteDraftsForRec(recommendationId);
    await updateRecStatus(recommendationId, "approved");
    const [recs, drafts] = await Promise.all([loadRecommendations(), loadDrafts()]);
    return NextResponse.json({ success: true, recommendations: recs, drafts });
  }

  if (action === "generate" && recommendationId) {
    const targetChars = typeof body.targetChars === "number" ? body.targetChars : undefined;
    return await triggerGeneration(req, user.id, recommendationId, targetChars);
  }

  if (action === "publish" && recommendationId) {
    await updateRecStatus(recommendationId, "published");
    return NextResponse.json({ success: true, recommendations: await loadRecommendations() });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ─── Analysis ────────────────────────────────────────────────────────────────

async function runAnalysis(userId: string, theme?: string) {
  // Seed les requêtes de veille avec le thème saisi (s'il y en a un) + coaching.
  const seeds = theme ? [theme, `${theme} coaching`, ...COACHING_SEEDS] : COACHING_SEEDS;

  const [liResult, webResult] = await Promise.allSettled([
    fetchLinkedInTrends(seeds, { num: 15 }),
    fetchWebCoachingTrends(theme ? [theme, "coaching trends"] : ["coaching trends", "leadership development"], { num: 10 }),
  ]);

  const linkedinTrends = liResult.status === "fulfilled" ? liResult.value : [];
  const webTrends = webResult.status === "fulfilled" ? webResult.value : [];

  if (linkedinTrends.length === 0 && webTrends.length === 0) {
    return NextResponse.json(
      { error: "No trends retrieved from LinkedIn or the web. Bright Data SERP may be unavailable (check BRIGHTDATA_API_KEY)." },
      { status: 400 },
    );
  }

  const liText = linkedinTrends.length > 0
    ? linkedinTrends.map((t, i) => `${i + 1}. "${t.title}"${t.snippet ? ` — ${t.snippet.slice(0, 160)}` : ""}`).join("\n")
    : "(none)";
  const webText = webTrends.length > 0
    ? webTrends.map((t, i) => `${i + 1}. "${t.title}" (${t.source})`).join("\n")
    : "(none)";

  const analysisTool: Anthropic.Tool = {
    name: "propose_linkedin_posts",
    description: "Propose 3 LinkedIn post ideas for Coachello, grounded in the real LinkedIn + web trends provided.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentences on the biggest LinkedIn content opportunity this cycle" },
        postIdeas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Specific, scroll-worthy post subject (not a vague theme)" },
              angle: { type: "string", description: "The distinctive angle / POV the post should take" },
              targetAudience: { type: "string", description: "Who this post speaks to (e.g. 'HRDs in scaleups', 'first-time managers')" },
              rationale: { type: "string", description: "Why now — tie it to a trend from the lists above" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["topic", "angle", "targetAudience", "rationale", "priority"],
          },
        },
      },
      required: ["summary", "postIdeas"],
    },
  };

  const prompt = `You are Coachello's senior social strategist. Propose the 3 best next LinkedIn posts.

${BUSINESS_CONTEXT_PROMPT_BLOCK}
${theme ? `\nThe user specifically wants ideas around this theme: "${theme}". Stay close to it.\n` : ""}
## What's trending on LinkedIn right now (real posts/articles on coaching)
${liText}

## What's trending on the web (coaching news)
${webText}

## Your job
Propose 3 distinct LinkedIn post ideas that:
- Ride a real trend above (reference it in the rationale), not random new bets
- Take a sharp, opinionated angle that positions Coachello as the expert HR/L&D buyers should hire
- Speak to Coachello's B2B leadership-coaching ICP — reject consumer/wellness/job-seeker angles
- Are specific post subjects, not vague themes

Call \`propose_linkedin_posts\`.`;

  const model = await getModelPreference("marketing", ANALYSIS_MODEL);
  const client = new Anthropic();
  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [analysisTool],
    tool_choice: { type: "tool", name: "propose_linkedin_posts" },
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "marketing_linkedin_analyze");

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`propose_linkedin_posts: no tool_use block. stop_reason=${message.stop_reason}`);
  }

  const parsed = toolUse.input as {
    summary: string;
    postIdeas: Array<{ topic: string; angle: string; targetAudience: string; rationale: string; priority: string }>;
  };

  const analysis: LinkedInContentAnalysis = {
    linkedinTrends: linkedinTrends.map((t) => ({ title: t.title, url: t.url, snippet: t.snippet, source: t.source, authorName: t.authorName, authorUrl: t.authorUrl })),
    webTrends: webTrends.map((t) => ({ title: t.title, url: t.url, source: t.source })),
    postIdeas: parsed.postIdeas.map((p) => ({ topic: p.topic, angle: p.angle, rationale: p.rationale })),
    summary: parsed.summary,
    dataSources: {
      linkedin: { ok: linkedinTrends.length > 0, count: linkedinTrends.length },
      web: { ok: webTrends.length > 0, count: webTrends.length },
    },
  };

  await saveAnalysis(userId, analysis);

  const newRecs: LinkedInPostRecommendation[] = parsed.postIdeas.map((p) => ({
    id: "",
    topic: p.topic,
    angle: p.angle,
    targetAudience: p.targetAudience,
    justification: p.rationale,
    priority: (p.priority as LinkedInPostRecommendation["priority"]) || "medium",
    status: "recommended",
  }));

  await saveRecommendations(userId, newRecs);
  const allRecs = await loadRecommendations();

  return NextResponse.json({ analysis, recommendations: allRecs, summary: parsed.summary });
}

// ─── Generation trigger ──────────────────────────────────────────────────────

/**
 * Generation runs as a Netlify Background Function (15 min cap), like the
 * article factory. In local dev / non-Netlify it runs inline.
 */
async function triggerGeneration(req: NextRequest, userId: string, recommendationId: string, targetChars?: number): Promise<NextResponse> {
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

    await updateRecStatus(rec.id, "writing");

    try {
      const bgRes = await fetch(`${siteUrl}/.netlify/functions/marketing-generate-linkedin-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ userId, recommendationId, targetChars }),
        signal: AbortSignal.timeout(8000),
      });
      if (bgRes.status !== 202 && !bgRes.ok) {
        const text = await bgRes.text().catch(() => "");
        console.error(`[marketing/linkedin/generate ${recommendationId}] bg trigger non-202/2xx (${bgRes.status}):`, text.slice(0, 200));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("aborted") && !msg.includes("timeout")) {
        console.error(`[marketing/linkedin/generate ${recommendationId}] bg trigger failed:`, msg);
        await updateRecStatus(rec.id, "approved");
        return NextResponse.json({ error: `Failed to enqueue generation: ${msg}` }, { status: 502 });
      }
    }
    return NextResponse.json({ queued: true, recommendationId }, { status: 202 });
  }

  // Local dev / non-Netlify: run inline.
  const result = await runLinkedInPostGeneration(userId, recommendationId, { targetChars });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const recs = await loadRecommendations();
  return NextResponse.json({ success: true, draft: result.draft, recommendations: recs });
}
