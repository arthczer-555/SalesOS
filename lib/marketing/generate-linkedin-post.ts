import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { BUSINESS_CONTEXT_PROMPT_BLOCK } from "@/lib/business-context";
import { fetchLinkedInTrends, type LinkedInTrendItem } from "@/lib/marketing/linkedin-trends";
import type { GeneratedLinkedInPost, LinkedInPostDraft, LinkedInPostRecommendation } from "@/lib/marketing-types";

const POST_MODEL_DEFAULT = "claude-sonnet-4-6";

const REC_SELECT = "id, user_id, topic, angle, target_audience, justification, priority, status, created_at";

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

async function getRec(recId: string): Promise<LinkedInPostRecommendation | null> {
  const { data } = await db
    .from("marketing_linkedin_recommendations")
    .select(REC_SELECT)
    .eq("id", recId)
    .maybeSingle();
  if (!data) return null;
  return mapDbRec(data as DbRec);
}

async function updateRecStatus(recId: string, status: LinkedInPostRecommendation["status"]): Promise<void> {
  await db
    .from("marketing_linkedin_recommendations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", recId);
}

async function deleteDraftsForRec(recId: string): Promise<void> {
  await db.from("marketing_linkedin_drafts").delete().eq("recommendation_id", recId);
}

async function saveDraft(userId: string, rec: LinkedInPostRecommendation, draft: LinkedInPostDraft): Promise<void> {
  await db.from("marketing_linkedin_drafts").insert({
    user_id: userId,
    recommendation_id: rec.id,
    topic: rec.topic,
    posts: draft.posts,
    inspiration: draft.inspiration,
  });
}

export type RunLinkedInGenerationResult =
  | { ok: true; draft: LinkedInPostDraft }
  | { ok: false; status: number; error: string };

export async function runLinkedInPostGeneration(
  userId: string,
  recommendationId: string,
): Promise<RunLinkedInGenerationResult> {
  const rec = await getRec(recommendationId);
  if (!rec) return { ok: false, status: 404, error: "Recommendation not found" };

  await updateRecStatus(rec.id, "writing");

  try {
    // ── Étape inspiration : aller lire de vrais posts LinkedIn sur le sujet ────
    // Ce sont nos références "ce qui marche" (hooks, format, ton, angles).
    // Best-effort : si la SERP est indisponible, on continue sans (le prompt
    // le précise).
    let inspiration: LinkedInTrendItem[] = [];
    try {
      const seeds = [rec.topic, `${rec.angle} coaching`, "leadership coaching", "executive coaching"]
        .map((s) => s.trim())
        .filter(Boolean);
      inspiration = await fetchLinkedInTrends(seeds, { num: 10 });
    } catch {
      // tendances best-effort
    }

    const inspirationText = inspiration.length > 0
      ? inspiration
          .map((p, i) => `${i + 1}. "${p.title}"${p.snippet ? `\n   ${p.snippet.slice(0, 220)}` : ""}`)
          .join("\n")
      : "(No live LinkedIn examples retrieved — rely on proven LinkedIn best practices below.)";

    const sharedContext = `${BUSINESS_CONTEXT_PROMPT_BLOCK}

## Brief for these LinkedIn posts
- Topic: ${rec.topic}
- Angle: ${rec.angle || "(choose the sharpest angle)"}
- Target audience: ${rec.targetAudience || "HR/L&D leaders and managers"}
- Why now (data-driven): ${rec.justification}

## Real LinkedIn posts on this theme (inspiration — what is currently working)
Study these for the hook style, structure, and tone that earn engagement. Do NOT copy them — extract the patterns (how they open, how they break lines, how they land a point) and apply them to Coachello's own POV.
${inspirationText}

## LinkedIn best practices (non-negotiable)
- The FIRST line is a scroll-stopping hook (a sharp claim, a surprising stat, a tension). It must work before the "...see more" cut.
- Short lines. Generous line breaks. White space between ideas. No dense paragraphs.
- One clear idea per post, defended with a concrete example or a specific number — never generic advice.
- Conversational, opinionated, human. No corporate jargon, no "In today's fast-paced world".
- Length: 1200–1800 characters (LinkedIn sweet spot).
- End with ONE engagement CTA (a question, an invitation to comment) — not a hard sell.
- NO external links inside the body (LinkedIn throttles them) — a soft mention of Coachello is fine.
- 3 to 5 relevant hashtags, returned separately (not inside the body).
- Use ONLY real, verifiable numbers (ICF, PwC, Gartner, McKinsey, HBR, BCG, Deloitte) — never invent statistics.

## What to produce
TWO distinct posts on this topic, with genuinely DIFFERENT angles (e.g. a contrarian take vs. a practical how-to, or a story-driven post vs. a data-driven one). They must not feel like rewrites of each other.

Write the posts in ENGLISH only.`;

    const writePostsTool: Anthropic.Tool = {
      name: "write_linkedin_posts",
      description: "Writes two distinct LinkedIn posts (different angles) in English, with hook and hashtags.",
      input_schema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            description: "Exactly two distinct posts.",
            items: {
              type: "object",
              properties: {
                angle: { type: "string", description: "Short label of the angle (e.g. 'Contrarian take', 'Practical how-to')" },
                hook: { type: "string", description: "The first line / scroll-stopper" },
                body: { type: "string", description: "Full post body in English (1200-1800 chars, line breaks included, no hashtags)" },
                hashtags: { type: "array", items: { type: "string" }, description: "3-5 hashtags without the # sign" },
              },
              required: ["angle", "hook", "body", "hashtags"],
            },
          },
        },
        required: ["posts"],
      },
    };

    const client = new Anthropic();
    const model = await getModelPreference("marketing", POST_MODEL_DEFAULT);

    const prompt = `You are Coachello's senior social editor. You write LinkedIn posts that HR/L&D leaders actually stop to read and comment on — opinionated, concrete, human.

${sharedContext}

Call the \`write_linkedin_posts\` tool with your complete output.`;

    const response = await client.messages.create({
      model,
      max_tokens: 6000,
      tools: [writePostsTool],
      tool_choice: { type: "tool", name: "write_linkedin_posts" },
      messages: [{ role: "user", content: prompt }],
    });

    logUsage(userId, model, response.usage.input_tokens, response.usage.output_tokens, "marketing_linkedin_generate");

    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude hit max_tokens limit. Try a narrower angle.");
    }

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(`No tool_use block. stop_reason: ${response.stop_reason}`);
    }

    const out = toolUse.input as { posts: GeneratedLinkedInPost[] };
    // Keep only posts with a real body; tolerate one weak post as long as one is solid.
    const posts = (Array.isArray(out.posts) ? out.posts : []).filter(
      (p) => typeof p?.body === "string" && p.body.trim().length >= 50,
    );
    if (posts.length === 0) {
      throw new Error(`No usable post returned. stop_reason: ${response.stop_reason}`);
    }

    const draft: LinkedInPostDraft = {
      recommendationId: rec.id,
      topic: rec.topic,
      posts,
      inspiration: inspiration.map((p) => ({ title: p.title, url: p.url, snippet: p.snippet })),
    };

    await deleteDraftsForRec(rec.id);
    await saveDraft(userId, rec, draft);
    await updateRecStatus(rec.id, "approved");

    return { ok: true, draft };
  } catch (e) {
    // Failure: revert status so the user can retry instead of seeing it stuck.
    await updateRecStatus(rec.id, "approved");
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "Generation failed" };
  }
}
