// ── Core du scan LinkedIn hebdo ──────────────────────────────────────────
// Extrait du route handler /api/linkedin/weekly-scan pour être appelable
// directement (fire-and-forget depuis /api/intel/agents/[id]/run) sans payer
// une 2e couche de proxy Vercel sujette à "Inactivity Timeout".

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import {
  searchPosts,
  getCompanyPosts,
  slugifyCompany,
  COACHING_KEYWORDS,
  JOB_CHANGE_KEYWORDS,
} from "@/lib/netrows";
import { getTargetCompanies, getAlertConfig } from "@/lib/target-companies";
import { signalScoringTool, SIGNAL_ANALYSIS_PROMPT } from "@/lib/signal-scoring";

export interface RunLinkedinScanOptions {
  companiesLimit?: number;
  keywordsLimit?: number;
  callerUserId: string | null; // null = cron / background
}

interface CompanyResult {
  company: string;
  newPosts: number;
  error?: string;
}

interface KeywordResult {
  keyword: string;
  newPosts: number;
  error?: string;
}

export interface RunLinkedinScanResult {
  company_posts: {
    companies_scanned: number;
    new_posts: number;
    details: CompanyResult[];
  };
  keyword_posts: {
    keywords_searched: number;
    new_posts: number;
    details: KeywordResult[];
  };
  analysis: {
    posts_analyzed: number;
    signals_created: number;
  };
  credits_used: number;
  debug: {
    target_companies_count: number;
    companies_limit: number;
    keywords_count: number;
  };
}

export async function runLinkedinScan(
  opts: RunLinkedinScanOptions,
): Promise<RunLinkedinScanResult> {
  const companiesLimit = Math.min(opts.companiesLimit ?? 50, 300);
  const keywordsLimit = Math.min(opts.keywordsLimit ?? 15, 30);
  const { callerUserId } = opts;

  const targetCompanies = await getTargetCompanies();
  let creditsUsed = 0;

  // Helpers : dédoublonnage + bulk insert pour ne pas attendre N round-trips
  // Supabase par post. Une fois la BG fn appelée, on tourne avec ~50 entreprises
  // et ~15 keywords, donc N peut monter à plusieurs centaines de posts.
  async function filterNewUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const { data } = await db
      .from("linkedin_posts_cache")
      .select("post_url")
      .in("post_url", urls);
    return new Set((data ?? []).map((r: { post_url: string }) => r.post_url));
  }

  // Batches parallèles : Netrows tolère plusieurs requêtes simultanées, mais
  // on garde une concurrence raisonnable pour ne pas s'auto-DDoS ni saturer
  // Supabase. 8 et 5 sont des valeurs prudentes basées sur les paliers
  // observés sur les autres scans.
  async function runInBatches<T, R>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const settled = await Promise.all(batch.map(fn));
      results.push(...settled);
    }
    return results;
  }

  // ── Phase 1: Company posts (batches de 8 en parallèle) ────────────
  const companies = targetCompanies.slice(0, companiesLimit);
  const companyPostsResults = await runInBatches(companies, 8, async (company) => {
    const username = slugifyCompany(company);
    try {
      const result = await getCompanyPosts(username);
      creditsUsed++;
      const posts = (result.data ?? []).filter((p) => !!p.postUrl);
      const urls = posts.map((p) => p.postUrl);
      const existing = await filterNewUrls(urls);
      const toInsert = posts
        .filter((p) => !existing.has(p.postUrl))
        .map((post) => ({
          post_url: post.postUrl,
          author_name: company,
          author_headline: "Company page",
          author_username: username,
          company_match: company,
          text_preview: (post.text ?? "").slice(0, 500),
          posted_at: post.postedAt ?? null,
          keyword_match: "company_post",
          is_processed: false,
        }));
      if (toInsert.length > 0) {
        await db.from("linkedin_posts_cache").insert(toInsert);
      }
      return { company, newPosts: toInsert.length } as CompanyResult;
    } catch (e) {
      creditsUsed++;
      return { company, newPosts: 0, error: String(e).slice(0, 100) } as CompanyResult;
    }
  });

  // ── Phase 2: Keyword posts (batches de 5 en parallèle) ────────────
  const coachingCount = Math.min(COACHING_KEYWORDS.length, Math.ceil(keywordsLimit * 0.7));
  const jobChangeCount = Math.min(JOB_CHANGE_KEYWORDS.length, keywordsLimit - coachingCount);
  const allKeywords = [
    ...COACHING_KEYWORDS.slice(0, coachingCount),
    ...JOB_CHANGE_KEYWORDS.slice(0, Math.max(1, jobChangeCount)),
  ].slice(0, keywordsLimit);

  const targetCompaniesLower = targetCompanies.map((c) => ({ name: c, lower: c.toLowerCase() }));
  const keywordPostsResults = await runInBatches(allKeywords, 5, async (kw) => {
    try {
      const result = await searchPosts(kw, "date_posted");
      creditsUsed++;
      const posts = (result.data ?? []).filter((p) => !!p.postUrl);
      const urls = posts.map((p) => p.postUrl);
      const existing = await filterNewUrls(urls);
      const toInsert = posts
        .filter((p) => !existing.has(p.postUrl))
        .map((post) => {
          const text = (post.text ?? "").toLowerCase();
          const headline = (post.author?.headline ?? "").toLowerCase();
          const companyMatch =
            targetCompaniesLower.find((c) => text.includes(c.lower) || headline.includes(c.lower))
              ?.name ?? null;
          return {
            post_url: post.postUrl,
            author_name: post.author?.name ?? null,
            author_headline: post.author?.headline ?? null,
            author_username: post.author?.username ?? null,
            company_match: companyMatch,
            text_preview: (post.text ?? "").slice(0, 500),
            posted_at: post.postedAt ?? null,
            keyword_match: kw,
            is_processed: false,
          };
        });
      if (toInsert.length > 0) {
        await db.from("linkedin_posts_cache").insert(toInsert);
      }
      return { keyword: kw, newPosts: toInsert.length } as KeywordResult;
    } catch (e) {
      creditsUsed++;
      return { keyword: kw, newPosts: 0, error: String(e).slice(0, 100) } as KeywordResult;
    }
  });

  // ── Phase 3: Analyse new posts with Claude ────────────────────────
  const { data: unprocessed } = await db
    .from("linkedin_posts_cache")
    .select("*")
    .eq("is_processed", false)
    .order("created_at", { ascending: false })
    .limit(50);

  let signalsCreated = 0;

  if (unprocessed && unprocessed.length > 0) {
    const postsText = unprocessed
      .map(
        (p, i) =>
          `[${i + 1}] ${p.author_name ?? "?"} (${p.author_headline ?? ""}) — ${
            p.company_match ? `Entreprise cible: ${p.company_match}` : "Hors cible"
          }\nKeyword: ${p.keyword_match}\n${p.text_preview ?? ""}`,
      )
      .join("\n\n---\n\n");

    const { data: modelPrefs } = await db
      .from("guide_defaults")
      .select("content")
      .eq("key", "model_preferences")
      .single();
    const marketModel = (() => {
      try {
        return (
          (JSON.parse(modelPrefs?.content ?? "{}") as Record<string, string>).market ??
          "claude-haiku-4-5-20251001"
        );
      } catch {
        return "claude-haiku-4-5-20251001";
      }
    })();

    const client = new Anthropic();
    const today = new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const message = await client.messages.create({
      model: marketModel,
      max_tokens: 4096,
      system:
        SIGNAL_ANALYSIS_PROMPT +
        `\n\nATTENTION : ces données viennent de LinkedIn (posts). Les signal_type possibles sont : "linkedin_post", "job_change", "nomination", "hiring", "content".\nPrivilégie les posts qui mentionnent les entreprises cibles ou qui indiquent un changement de poste RH/L&D.`,
      messages: [
        {
          role: "user",
          content: `Nous sommes le ${today}.\n\nVoici ${unprocessed.length} posts LinkedIn récents :\n\n${postsText}\n\nAnalyse et score. Utilise l'outil score_signals.`,
        },
      ],
      tools: [signalScoringTool],
      tool_choice: { type: "tool" as const, name: "score_signals" },
    });

    if (callerUserId) {
      logUsage(
        callerUserId,
        marketModel,
        message.usage.input_tokens,
        message.usage.output_tokens,
        "linkedin_weekly",
      );
    }

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    const signals =
      toolBlock && "input" in toolBlock
        ? ((
            toolBlock.input as {
              signals: {
                company_name: string;
                signal_type: string;
                title: string;
                summary: string;
                score: number;
                score_breakdown: Record<string, number>;
                why_relevant: string;
                suggested_action: string;
                action_type: string;
                source_url?: string;
                source_domain?: string;
                signal_date?: string;
              }[];
            }
          ).signals ?? [])
        : [];

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
          })),
        );
        if (!error) signalsCreated++;
      }
    }

    const processedIds = unprocessed.map((p) => p.id);
    await db.from("linkedin_posts_cache").update({ is_processed: true }).in("id", processedIds);
  }

  // ── Phase 4: Slack alerts ─────────────────────────────────────────
  const alertConfig = await getAlertConfig();
  if (alertConfig.enabled && signalsCreated > 0) {
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
        const emoji = (score: number) => (score >= 70 ? "🟢" : score >= 50 ? "🟡" : "🔴");
        const lines = [
          `🔔 *${newSignals.length} signal${newSignals.length > 1 ? "ux" : ""} LinkedIn détecté${
            newSignals.length > 1 ? "s" : ""
          }*`,
          "",
          ...newSignals
            .slice(0, 5)
            .map(
              (s) =>
                `${emoji(s.score)} *${s.score}/100* — ${s.company_name} : ${s.title}\n→ ${
                  s.suggested_action ?? ""
                }`,
            ),
        ];
        try {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel: channelId, text: lines.join("\n") }),
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
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
  };
}
