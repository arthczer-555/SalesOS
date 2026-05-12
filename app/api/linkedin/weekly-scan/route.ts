import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { searchPosts, getCompanyPosts, slugifyCompany, COACHING_KEYWORDS, JOB_CHANGE_KEYWORDS } from "@/lib/netrows";
import { getTargetCompanies, getAlertConfig } from "@/lib/target-companies";
import { signalScoringTool, SIGNAL_ANALYSIS_PROMPT } from "@/lib/signal-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/linkedin/weekly-scan
// Auth: logged-in user OR CRON_SECRET
// Params: { companiesLimit?: number, keywordsLimit?: number }
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let callerUserId: string | null = null;
    if (!isCron) {
      const user = await getAuthenticatedUser();
      if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
      callerUserId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const companiesLimit = Math.min(body.companiesLimit ?? 50, 300);
    const keywordsLimit = Math.min(body.keywordsLimit ?? 15, 30);

    const targetCompanies = await getTargetCompanies();
    let creditsUsed = 0;

    // ── Phase 1: Company posts ────────────────────────────────────────
    const companyPostsResults: { company: string; newPosts: number }[] = [];

    for (let i = 0; i < Math.min(targetCompanies.length, companiesLimit); i++) {
      const company = targetCompanies[i];
      const username = slugifyCompany(company);

      try {
        const result = await getCompanyPosts(username);
        creditsUsed++;
        const posts = result.data ?? [];

        let newCount = 0;
        for (const post of posts) {
          if (!post.postUrl) continue;
          // Check if already in cache
          const { data: existing } = await db
            .from("linkedin_posts_cache")
            .select("id")
            .eq("post_url", post.postUrl)
            .maybeSingle();

          if (!existing) {
            await db.from("linkedin_posts_cache").insert({
              post_url: post.postUrl,
              author_name: company,
              author_headline: "Company page",
              author_username: username,
              company_match: company,
              text_preview: (post.text ?? "").slice(0, 500),
              posted_at: post.postedAt ?? null,
              keyword_match: "company_post",
              is_processed: false,
            });
            newCount++;
          }
        }
        companyPostsResults.push({ company, newPosts: newCount });
      } catch (e) {
        companyPostsResults.push({ company, newPosts: 0, error: String(e).slice(0, 100) } as typeof companyPostsResults[0]);
        creditsUsed++;
      }

      // Rate limit
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 2000));
    }

    // ── Phase 2: Keyword posts ────────────────────────────────────────
    const coachingCount = Math.min(COACHING_KEYWORDS.length, Math.ceil(keywordsLimit * 0.7));
    const jobChangeCount = Math.min(JOB_CHANGE_KEYWORDS.length, keywordsLimit - coachingCount);
    const allKeywords = [
      ...COACHING_KEYWORDS.slice(0, coachingCount),
      ...JOB_CHANGE_KEYWORDS.slice(0, Math.max(1, jobChangeCount)),
    ].slice(0, keywordsLimit);

    const keywordPostsResults: { keyword: string; newPosts: number }[] = [];

    for (const kw of allKeywords) {
      try {
        const result = await searchPosts(kw, "date_posted");
        creditsUsed++;
        const posts = result.data ?? [];

        let newCount = 0;
        for (const post of posts) {
          if (!post.postUrl) continue;

          const { data: existing } = await db
            .from("linkedin_posts_cache")
            .select("id")
            .eq("post_url", post.postUrl)
            .maybeSingle();

          if (!existing) {
            // Check if this post matches a target company
            const companyMatch = targetCompanies.find((c) =>
              (post.text ?? "").toLowerCase().includes(c.toLowerCase()) ||
              (post.author?.headline ?? "").toLowerCase().includes(c.toLowerCase())
            );

            await db.from("linkedin_posts_cache").insert({
              post_url: post.postUrl,
              author_name: post.author?.name ?? null,
              author_headline: post.author?.headline ?? null,
              author_username: post.author?.username ?? null,
              company_match: companyMatch ?? null,
              text_preview: (post.text ?? "").slice(0, 500),
              posted_at: post.postedAt ?? null,
              keyword_match: kw,
              is_processed: false,
            });
            newCount++;
          }
        }
        keywordPostsResults.push({ keyword: kw, newPosts: newCount });
      } catch (e) {
        keywordPostsResults.push({ keyword: kw, newPosts: 0, error: String(e).slice(0, 100) } as typeof keywordPostsResults[0]);
        creditsUsed++;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    // ── Phase 3: Analyse new posts with Claude ────────────────────────
    const { data: unprocessed } = await db
      .from("linkedin_posts_cache")
      .select("*")
      .eq("is_processed", false)
      .order("created_at", { ascending: false })
      .limit(50);

    let signalsCreated = 0;

    if (unprocessed && unprocessed.length > 0) {
      const postsText = unprocessed.map((p, i) =>
        `[${i + 1}] ${p.author_name ?? "?"} (${p.author_headline ?? ""}) — ${p.company_match ? `Entreprise cible: ${p.company_match}` : "Hors cible"}\nKeyword: ${p.keyword_match}\n${p.text_preview ?? ""}`
      ).join("\n\n---\n\n");

      const { data: modelPrefs } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
      const marketModel = (() => { try { return (JSON.parse(modelPrefs?.content ?? "{}") as Record<string, string>).market ?? "claude-haiku-4-5-20251001"; } catch { return "claude-haiku-4-5-20251001"; } })();

      const client = new Anthropic();
      const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

      const message = await client.messages.create({
        model: marketModel,
        max_tokens: 4096,
        system: SIGNAL_ANALYSIS_PROMPT + `\n\nATTENTION : ces données viennent de LinkedIn (posts). Les signal_type possibles sont : "linkedin_post", "job_change", "nomination", "hiring", "content".\nPrivilégie les posts qui mentionnent les entreprises cibles ou qui indiquent un changement de poste RH/L&D.`,
        messages: [{
          role: "user",
          content: `Nous sommes le ${today}.\n\nVoici ${unprocessed.length} posts LinkedIn récents :\n\n${postsText}\n\nAnalyse et score. Utilise l'outil score_signals.`,
        }],
        tools: [signalScoringTool],
        tool_choice: { type: "tool" as const, name: "score_signals" },
      });

      const logUser = callerUserId ?? "cron";
      if (callerUserId) {
        logUsage(callerUserId, marketModel, message.usage.input_tokens, message.usage.output_tokens, "linkedin_weekly");
      }

      const toolBlock = message.content.find((b) => b.type === "tool_use");
      const signals = toolBlock && "input" in toolBlock
        ? ((toolBlock.input as { signals: { company_name: string; signal_type: string; title: string; summary: string; score: number; score_breakdown: Record<string, number>; why_relevant: string; suggested_action: string; action_type: string; source_url?: string; source_domain?: string; signal_date?: string }[] }).signals ?? [])
        : [];

      // Store signals for all users
      if (signals.length > 0) {
        const { data: allUsers } = await db.from("users").select("id");
        const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

        for (const signal of signals) {
          const agentId =
            signal.signal_type === "job_change"
              ? "job-change"
              : signal.signal_type === "hiring"
                ? "hiring-spike"
                : signal.signal_type === "content"
                  ? "intent-content"
                  : "company-news";
          const { error } = await db.from("market_signals").insert(
            userIds.map((userId) => ({
              user_id: userId,
              agent_id: agentId,
              company_name: signal.company_name,
              signal_type: signal.signal_type,
              title: signal.title,
              summary: signal.summary,
              signal_date: signal.signal_date ?? null,
              strength: signal.score >= 70 ? 3 : signal.score >= 40 ? 2 : 1,
              source_url: signal.source_url ?? null,
              source_domain: signal.source_domain ?? "linkedin.com",
              score: signal.score,
              score_breakdown: signal.score_breakdown,
              why_relevant: signal.why_relevant,
              suggested_action: signal.suggested_action,
              action_type: signal.action_type,
              is_read: false,
              is_actioned: false,
            }))
          );
          if (!error) signalsCreated++;
        }
      }

      // Mark posts as processed
      const processedIds = unprocessed.map((p) => p.id);
      await db.from("linkedin_posts_cache").update({ is_processed: true }).in("id", processedIds);
    }

    // ── Phase 4: Slack alerts ─────────────────────────────────────────
    const alertConfig = await getAlertConfig();
    if (alertConfig.enabled && signalsCreated > 0) {
      // Fetch high-priority signals just created
      const { data: newSignals } = await db
        .from("market_signals")
        .select("*")
        .gte("score", alertConfig.min_score ?? 70)
        .order("created_at", { ascending: false })
        .limit(signalsCreated);

      if (newSignals && newSignals.length > 0) {
        const token = process.env.SLACK_BOT_TOKEN;
        const channelId = alertConfig.slack_channel;
        if (token && channelId) {
          const emoji = (score: number) => score >= 70 ? "🟢" : score >= 50 ? "🟡" : "🔴";
          const lines = [
            `🔔 *${newSignals.length} signal${newSignals.length > 1 ? "ux" : ""} LinkedIn détecté${newSignals.length > 1 ? "s" : ""}*`,
            "",
            ...newSignals.slice(0, 5).map((s) =>
              `${emoji(s.score)} *${s.score}/100* — ${s.company_name} : ${s.title}\n→ ${s.suggested_action ?? ""}`
            ),
          ];
          try {
            await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ channel: channelId, text: lines.join("\n") }),
            });
          } catch { /* ignore */ }
        }
      }
    }

    return NextResponse.json({
      company_posts: {
        companies_scanned: companyPostsResults.length,
        new_posts: companyPostsResults.reduce((s, r) => s + r.newPosts, 0),
        details: companyPostsResults.slice(0, 10),
      },
      keyword_posts: {
        keywords_searched: keywordPostsResults.length,
        new_posts: keywordPostsResults.reduce((s, r) => s + r.newPosts, 0),
        details: keywordPostsResults.slice(0, 10),
      },
      analysis: {
        posts_analyzed: unprocessed?.length ?? 0,
        signals_created: signalsCreated,
      },
      credits_used: creditsUsed,
      debug: {
        target_companies_count: targetCompanies.length,
        companies_limit: companiesLimit,
        keywords_count: allKeywords.length,
      },
    });
  } catch (e) {
    console.error("[linkedin/weekly-scan] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
