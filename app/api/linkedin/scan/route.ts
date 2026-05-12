import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { searchPosts, getCompanyPosts, slugifyCompany, COACHING_KEYWORDS, JOB_CHANGE_KEYWORDS } from "@/lib/netrows";
import { getTargetCompanies } from "@/lib/target-companies";
import { signalScoringTool, SIGNAL_ANALYSIS_PROMPT } from "@/lib/signal-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/linkedin/scan?mode=keywords  → scan posts par mots-clés (15 crédits)
// POST /api/linkedin/scan?mode=companies → scan posts entreprises cibles (1 crédit/entreprise)
// POST /api/linkedin/scan?mode=test&keyword=xxx → test 1 mot-clé (1 crédit)
// POST /api/linkedin/scan?mode=test_company&company=xxx → test 1 entreprise (1 crédit)

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const mode = req.nextUrl.searchParams.get("mode") ?? "keywords";

    // ── Test mode: 1 keyword or 1 company (1 credit) ─────────────────
    if (mode === "test") {
      const keyword = req.nextUrl.searchParams.get("keyword");
      if (!keyword) return NextResponse.json({ error: "keyword requis" }, { status: 400 });
      const result = await searchPosts(keyword, "date_posted");
      return NextResponse.json({ keyword, posts: result.data ?? [], credits_used: 1 });
    }

    if (mode === "test_company") {
      const company = req.nextUrl.searchParams.get("company");
      if (!company) return NextResponse.json({ error: "company requis" }, { status: 400 });
      const result = await getCompanyPosts(company);
      return NextResponse.json({ company, posts: result.data ?? [], credits_used: 1 });
    }

    // ── Keywords scan (coaching/L&D + job changes) ────────────────────
    if (mode === "keywords") {
      const allKeywords = [...COACHING_KEYWORDS.slice(0, 10), ...JOB_CHANGE_KEYWORDS.slice(0, 5)];
      const allPosts: { keyword: string; posts: unknown[] }[] = [];

      for (const kw of allKeywords) {
        try {
          const result = await searchPosts(kw, "date_posted");
          allPosts.push({ keyword: kw, posts: result.data ?? [] });
        } catch { /* skip failed searches */ }
      }

      const totalPosts = allPosts.reduce((s, p) => s + p.posts.length, 0);

      // Analyse with Claude if we have posts
      if (totalPosts > 0) {
        const postsText = allPosts
          .filter((p) => p.posts.length > 0)
          .map((p) => `[${p.keyword}]\n${(p.posts as { text: string; author?: { name: string; headline: string } }[]).slice(0, 3).map((post) =>
            `${post.author?.name ?? "?"} (${post.author?.headline ?? ""}): ${post.text?.slice(0, 300)}`
          ).join("\n")}`)
          .join("\n\n---\n\n");

        const { data: modelPrefs } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
        const marketModel = (() => { try { return (JSON.parse(modelPrefs?.content ?? "{}") as Record<string, string>).market ?? "claude-haiku-4-5-20251001"; } catch { return "claude-haiku-4-5-20251001"; } })();

        const client = new Anthropic();
        const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        const targetCompanies = await getTargetCompanies();

        const message = await client.messages.create({
          model: marketModel,
          max_tokens: 4096,
          system: SIGNAL_ANALYSIS_PROMPT,
          messages: [{
            role: "user",
            content: `Nous sommes le ${today}.\n\nENTREPRISES CIBLES : ${targetCompanies.slice(0, 50).join(", ")}...\n\nVoici des posts LinkedIn récents détectés par mots-clés :\n\n${postsText}\n\nAnalyse ces posts. Utilise l'outil score_signals. Privilégie les posts qui concernent les entreprises cibles.`,
          }],
          tools: [signalScoringTool],
          tool_choice: { type: "tool" as const, name: "score_signals" },
        });

        logUsage(user.id, marketModel, message.usage.input_tokens, message.usage.output_tokens, "linkedin_scan");

        const toolBlock = message.content.find((b) => b.type === "tool_use");
        const signals = toolBlock && "input" in toolBlock
          ? ((toolBlock.input as { signals: unknown[] }).signals ?? [])
          : [];

        return NextResponse.json({
          mode: "keywords",
          keywords_searched: allKeywords.length,
          total_posts: totalPosts,
          signals_detected: signals.length,
          credits_used: allKeywords.length,
          signals,
        });
      }

      return NextResponse.json({
        mode: "keywords",
        keywords_searched: allKeywords.length,
        total_posts: 0,
        signals_detected: 0,
        credits_used: allKeywords.length,
      });
    }

    // ── Companies scan ────────────────────────────────────────────────
    if (mode === "companies") {
      const targetCompanies = await getTargetCompanies();
      const limit = Math.min(targetCompanies.length, 10); // Limit for testing
      const allPosts: { company: string; posts: unknown[] }[] = [];

      for (let i = 0; i < limit; i++) {
        try {
          const result = await getCompanyPosts(slugifyCompany(targetCompanies[i]));
          allPosts.push({ company: targetCompanies[i], posts: result.data ?? [] });
        } catch { /* skip */ }
      }

      return NextResponse.json({
        mode: "companies",
        companies_scanned: limit,
        total_posts: allPosts.reduce((s, p) => s + p.posts.length, 0),
        credits_used: limit,
        results: allPosts.map((p) => ({ company: p.company, posts_count: p.posts.length })),
      });
    }

    return NextResponse.json({ error: "mode invalide (keywords, companies, test, test_company)" }, { status: 400 });
  } catch (e) {
    console.error("[linkedin/scan] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
