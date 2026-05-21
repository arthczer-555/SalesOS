import { db } from "@/lib/db";
import {
  getCompanyPosts,
  slugifyCompany,
  NetrowsNotFoundError,
  NetrowsAuthError,
  NetrowsCreditsError,
  NetrowsRateLimitError,
} from "@/lib/netrows";
import type { NewsContent, NewsSignalSnapshot } from "@/lib/watchlist/briefs";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface FetchNewsInput {
  scopeCompanyId: string;
  userId: string;
  companyName: string;
}

/**
 * Fetch des news pour un compte Watch List :
 * - posts LinkedIn récents via Netrows getCompanyPosts (1 seul page, pas de pagination)
 * - signaux intel (market_signals) des 30 derniers jours filtrés par nom de compagnie
 *
 * En cas de NetrowsNotFoundError ou si le slug heuristique ne correspond pas,
 * on renvoie posts: [] sans planter (les signaux restent disponibles).
 */
export async function fetchWatchlistNews(input: FetchNewsInput): Promise<NewsContent> {
  const { userId, companyName } = input;

  const slug = slugifyCompany(companyName);

  // ── Netrows posts ────────────────────────────────────────────────────────
  let posts: NewsContent["posts"] = [];
  let creditsUsed = 0;

  if (slug) {
    try {
      const res = await getCompanyPosts(slug, 0);
      posts = res.data ?? [];
      creditsUsed = 1;
    } catch (e) {
      if (
        e instanceof NetrowsAuthError ||
        e instanceof NetrowsCreditsError ||
        e instanceof NetrowsRateLimitError
      ) {
        throw e;
      }
      if (e instanceof NetrowsNotFoundError) {
        posts = [];
      } else {
        throw e;
      }
    }
  }

  // ── Intel signals (market_signals) ───────────────────────────────────────
  const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const { data: signalsData } = await db
    .from("market_signals")
    .select("id, signal_type, title, summary, source_url, created_at")
    .eq("user_id", userId)
    .ilike("company_name", companyName)
    .eq("archived", false)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(30);

  const signals: NewsSignalSnapshot[] = (signalsData ?? []).map((s) => ({
    id: s.id,
    type: s.signal_type,
    title: s.title,
    url: s.source_url,
    created_at: s.created_at,
    excerpt: s.summary,
  }));

  return {
    posts,
    signals,
    fetched_at: new Date().toISOString(),
    netrows_credits_used: creditsUsed,
  };
}
