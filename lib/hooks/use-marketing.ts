import useSWR from "swr";
import type {
  MarketingKPI,
  TrafficDataPoint,
  TrafficSource,
  GA4TopArticle,
  Keyword,
  CannibalizationAlert,
  ContentAnalysis,
  ArticleRecommendation,
  ArticleDraft,
  DynamicCompetitorBenchmark,
} from "@/lib/marketing-types";

const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 30_000 } as const;

// ─── Overview ────────────────────────────────────────────────────────────────

interface OverviewResponse {
  kpis: MarketingKPI | null;
  trafficData: TrafficDataPoint[];
  trafficSources: TrafficSource[];
  topPages: GA4TopArticle[];
  source: "ga4" | "mock" | "none";
  ga4Error?: string;
}

export function useMarketingOverview(period: 7 | 14 | 30 | 90 | 365) {
  const { data, error, isLoading } = useSWR<OverviewResponse>(
    `/api/marketing/overview?period=${period}`,
    SWR_OPTS,
  );
  return {
    kpis: data?.kpis ?? null,
    trafficData: data?.trafficData ?? [],
    trafficSources: data?.trafficSources ?? [],
    topPages: data?.topPages ?? [],
    source: data?.source ?? "none",
    ga4Error: data?.ga4Error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
  };
}

// ─── SEO ─────────────────────────────────────────────────────────────────────

interface SeoResponse {
  keywords: Keyword[];
  cannibalizationAlerts: CannibalizationAlert[];
  error?: string;
}

export function useMarketingSeo(days = 28, opportunitiesOnly = false) {
  const params = new URLSearchParams({ days: String(days) });
  if (opportunitiesOnly) params.set("opportunities", "true");
  const { data, error, isLoading } = useSWR<SeoResponse>(
    `/api/marketing/seo?${params.toString()}`,
    SWR_OPTS,
  );
  return {
    keywords: data?.keywords ?? [],
    cannibalizationAlerts: data?.cannibalizationAlerts ?? [],
    seoError: data?.error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
  };
}

// ─── Articles ────────────────────────────────────────────────────────────────

interface ArticleItem {
  id: string;
  title: string;
  slug: string;
  publishedDate: string;
  link: string;
  sessions: number;
  pageViews: number;
}

interface ArticlesResponse {
  articles: ArticleItem[];
  error?: string;
}

export function useMarketingArticles(sort = "sessions", order = "desc") {
  const params = new URLSearchParams({ sort, order });
  const { data, error, isLoading } = useSWR<ArticlesResponse>(
    `/api/marketing/articles?${params.toString()}`,
    SWR_OPTS,
  );
  return {
    articles: data?.articles ?? [],
    articlesError: data?.error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
  };
}

// ─── Content Factory ─────────────────────────────────────────────────────────

interface ContentResponse {
  analysis: ContentAnalysis | null;
  recommendations: ArticleRecommendation[];
  drafts: ArticleDraft[];
}

export function useMarketingContent() {
  const { data, error, isLoading, mutate } = useSWR<ContentResponse>(
    `/api/marketing/content`,
    SWR_OPTS,
  );
  return {
    analysis: data?.analysis ?? null,
    recommendations: data?.recommendations ?? [],
    drafts: data?.drafts ?? [],
    isLoading,
    error: error ? "Loading error" : "",
    reload: () => mutate(),
  };
}

// ─── Recommendations ─────────────────────────────────────────────────────────

export type { DynamicCompetitorBenchmark };

interface RecommendationsResponse {
  competitors: DynamicCompetitorBenchmark[];
  competitorNames: string[];
  error?: string;
}

export function useMarketingRecommendations() {
  const { data, error, isLoading } = useSWR<RecommendationsResponse>(
    `/api/marketing/recommendations`,
    SWR_OPTS,
  );
  return {
    competitors: data?.competitors ?? [],
    competitorNames: data?.competitorNames ?? [],
    recoError: data?.error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
  };
}
