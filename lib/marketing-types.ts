// ─── Shared types for the marketing dashboard ──────────────────────────────

// Overview
export interface MarketingKPI {
  sessions: number;
  sessionsWoW: number;
  uniqueVisitors: number;
  uniqueVisitorsWoW: number;
  pageViews: number;
  pageViewsWoW: number;
  bounceRate: number;
  bounceRateWoW: number;
  avgDuration: number;
  avgDurationWoW: number;
  ctaConversions: number;
  ctaConversionsWoW: number;
}

export interface TrafficDataPoint {
  date: string;
  sessions: number;
  visitors: number;
  pageViews: number;
}

export interface TrafficSource {
  source: string;
  sessions: number;
  percentage: number;
  color: string;
}

export interface GA4TopArticle {
  path: string;
  title: string;
  sessions: number;
  pageViews: number;
}

// SEO
export interface Keyword {
  keyword: string;
  page: string | null;
  pageTitle: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export interface CannibalizationAlert {
  keyword: string;
  articles: { page: string; title: string; position: number; impressions: number }[];
}

// Articles (from WordPress + GA4)
export interface BlogArticle {
  id: number;
  title: string;
  slug: string;
  date: string;
  link: string;
  excerpt: string;
  image: string | null;
  categories: string[];
  sessions?: number;
  pageViews?: number;
}

// Content Factory
export interface ContentAnalysis {
  topPerformers: { title: string; sessions: number; trend: number }[];
  risingTrends: { keyword: string; growth: number }[];
  contentGaps: { topic: string; competitorsCovering: string[] }[];
}

export interface ArticleRecommendation {
  id: string;
  topic: string;
  targetKeyword: string;
  justification: string;
  estimatedTraffic: number;
  difficulty: "easy" | "medium" | "hard";
  priority: "high" | "medium" | "low";
  status: "recommended" | "approved" | "writing" | "published";
}

export interface InternalLink {
  anchorText: string;
  targetArticleTitle: string;
  targetUrl: string;
}

export interface ArticleDraft {
  recommendationId: string;
  content: { fr: string; en: string };
  wordpressFormat: {
    fr: { category: string; tags: string[]; excerpt: string; slug: string };
    en: { category: string; tags: string[]; excerpt: string; slug: string };
  };
  styleMatchScore: number;
  internalLinks: { fr: InternalLink[]; en: InternalLink[] };
}

// Recommendations
export interface DynamicCompetitorBenchmark {
  topic: string;
  coachello: boolean;
  competitors: Record<string, boolean>;
}
