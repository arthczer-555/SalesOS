// ─── Shared types for the marketing dashboard ──────────────────────────────

// Overview
export interface MarketingKPI {
  sessions: number;
  sessionsWoW: number;
  activeUsers: number;
  activeUsersWoW: number;
  newUsers: number;
  newUsersWoW: number;
  pageViews: number;
  pageViewsWoW: number;
  engagedSessions: number;
  engagedSessionsWoW: number;
  avgDuration: number;
  avgDurationWoW: number;
  keyEvents: number;
  keyEventsWoW: number;
  incomingLeads: number;
  incomingLeadsWoW: number;
  incomingLeadsChannelMissing?: boolean;
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
  /** Sub-source breakdown (e.g. for Referral: "linkedin.com / referral: 42"). */
  details?: { label: string; sessions: number }[];
}

export interface GA4TopArticle {
  path: string;
  title: string;
  sessions: number;
  pageViews: number;
}

export interface DeviceBreakdown {
  device: string;
  sessions: number;
  activeUsers: number;
  engagementRate: number;
  avgDuration: number;
  percentage: number;
}

export interface CountryBreakdown {
  country: string;
  sessions: number;
  activeUsers: number;
  percentage: number;
}

export interface LeadsTimelinePoint {
  date: string;   // YYYY-MM-DD (Europe/Paris)
  count: number;
}

export interface ImpressionsTimelinePoint {
  date: string;   // YYYY-MM-DD
  impressions: number;
  clicks: number;
}

export interface ArticleTimelinePoint {
  date: string;   // YYYY-MM-DD
  id: number;
  title: string;
  link: string;
  slug: string;
}

export type MarketingEventType = "salon" | "linkedin_pro" | "linkedin_perso" | "nurturing_campaign";

export interface MarketingEvent {
  id: string;
  event_date: string;   // YYYY-MM-DD
  event_type: MarketingEventType;
  label: string;
  created_by: string;
  created_at: string;
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

// Trends: gain/loss of clicks per page between two consecutive periods
export interface PageTrend {
  page: string;
  title: string;
  currentClicks: number;
  previousClicks: number;
  deltaClicks: number;
  currentImpressions: number;
  previousImpressions: number;
  deltaImpressions: number;
  currentPosition: number;      // average position in current period
  deltaPosition: number;        // positive = position worsened (moved down); negative = improved
}

export interface SeoTrendsResponse {
  winners: PageTrend[];
  losers: PageTrend[];
  error?: string;
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
  topPerformers: { title: string; sessions: number; path: string }[];
  risingTrends: { keyword: string; impressions: number; clicks: number; ctr: number; position: number }[];
  contentGaps: { topic: string; rationale: string; targetKeyword: string }[];
  summary: string;
  dataSources?: {
    ga4: { ok: boolean; error?: string; pagesCount: number };
    searchConsole: { ok: boolean; error?: string; keywordsCount: number };
    wordpress: { ok: boolean; error?: string; articlesCount: number };
  };
}

export interface ArticleAuthor {
  name: string | null;
  email: string;
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
  relevanceScore?: number;
  relevanceReason?: string;
  relevanceCategory?: "relevant" | "partial" | "irrelevant";
  createdAt?: string;
  author?: ArticleAuthor | null;
}

export interface KeywordRelevance {
  keyword: string;
  relevanceScore: number;
  category: "relevant" | "partial" | "irrelevant";
  reason: string;
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
  author?: ArticleAuthor | null;
}

// Recommendations
export interface DynamicCompetitorBenchmark {
  topic: string;
  coachello: boolean;
  competitors: Record<string, boolean>;
}

// Leads (admin tab)
export type LeadValidationStatus = "pending" | "validated" | "rejected";

export interface LeadFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  thumb_url?: string;
}

export interface Lead {
  id: string;
  slack_ts: string;
  slack_permalink: string | null;
  author_name: string | null;
  text: string;
  files: LeadFile[];
  posted_at: string;
  validation_status: LeadValidationStatus;
  validated_by: string | null;
  validated_at: string | null;
  last_analysis_id: string | null;
  analysis_status: LeadAnalysisStatus | null;
  analyzed_at: string | null;
}

export interface LeadsCounts {
  pending: number;
  validated: number;
  rejected: number;
  validatedWithDeal: number;
  validatedWithoutDeal: number;
  validatedWithLead: number;
  validatedWithoutLead: number;
  validatedWithContact: number;
}

export type LeadAnalysisStatus = "pending" | "done" | "no_match" | "error";

export type LeadMatchStrategy = "email" | "person" | "company" | "none";

export interface LeadDealScoreSummary {
  total: number;
  reliability: number;
  scored_at: string | null;
  next_action: string | null;
}

export interface LeadAnalysis {
  id: string;
  lead_id: string;
  status: LeadAnalysisStatus;
  extracted_email: string | null;
  extracted_name: string | null;
  extracted_company: string | null;
  extracted_source: string | null;
  extraction_confidence: number | null;
  extraction_notes: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  match_strategy: LeadMatchStrategy | null;
  // Contact snapshot (object type "contacts")
  contact_email: string | null;
  contact_name: string | null;
  contact_lifecyclestage: string | null;
  contact_hs_lead_status: string | null;
  contact_owner_id: string | null;
  contact_owner_name: string | null;
  // HubSpot Lead-object snapshot (CRM object type 0-136 — distinct from Contact)
  hubspot_lead_id: string | null;
  hubspot_lead_name: string | null;
  hubspot_lead_pipeline_id: string | null;
  hubspot_lead_stage_id: string | null;
  hubspot_lead_stage_label: string | null;
  hubspot_lead_owner_id: string | null;
  hubspot_lead_owner_name: string | null;
  // Deal snapshot
  deal_name: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_amount: number | null;
  deal_close_date: string | null;
  deal_owner_id: string | null;
  deal_owner_name: string | null;
  deal_is_closed: boolean | null;
  deal_is_closed_won: boolean | null;
  time_to_deal_seconds: number | null;
  time_to_close_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deal_score?: LeadDealScoreSummary | null;
}

export interface LeadWithAnalysis extends Lead {
  analysis: LeadAnalysis | null;
}

// Canonical lead-origin categories. Shared between Claude's extraction enum and
// the manual source editor UI so that hand-typed values aggregate cleanly with
// AI-detected ones in the funnel widget.
export const LEAD_SOURCE_CATEGORIES = [
  "LinkedIn",
  "Chatbot",
  "Web Search",
  "Recommandation",
  "Évènement",
  "Presse",
  "Autre",
] as const;

export type LeadSourceCategory = (typeof LEAD_SOURCE_CATEGORIES)[number];

// Aggregated origin of validated leads, grouped after a case-insensitive
// normalisation of `extracted_source` (so "LinkedIn"/"linkedin" merge).
export interface LeadSourceBucket {
  source: string;        // display label (most frequent original casing)
  count: number;
}

// Per-sales performance over the funnel window.
export interface SalesPerformanceRow {
  ownerId: string;
  ownerName: string;
  leadsCount: number;          // distinct validated leads attributed to this owner
  dealsCount: number;          // distinct hubspot_deal_id
  wonCount: number;
  lostCount: number;
  openPipelineAmount: number;
  wonAmount: number;
  conversionPct: number;       // wonCount / leadsCount (0..100)
}

export interface LeadsFunnel {
  period: { from: string; to: string };
  funnel: {
    totalLeads: number;
    validated: number;
    withDeal: number;
    disco: number;
    closedWon: number;
    closedLost: number;
    bySource: LeadSourceBucket[];
    bySales: SalesPerformanceRow[];
  };
  openPipelineAmount: number;
  closedLostAmount: number;
}
