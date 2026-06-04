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
  LinkedInContentAnalysis,
  LinkedInPostRecommendation,
  LinkedInPostDraft,
  PageTrend,
  SeoTrendsResponse,
  DeviceBreakdown,
  CountryBreakdown,
  LeadsTimelinePoint,
  ImpressionsTimelinePoint,
  ArticleTimelinePoint,
  MarketingEvent,
  MarketingEventType,
  LeadsCounts,
  LeadValidationStatus,
  LeadWithAnalysis,
  LeadsFunnel,
} from "@/lib/marketing-types";

const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 30_000 } as const;

// ─── Overview ────────────────────────────────────────────────────────────────

interface OverviewResponse {
  kpis: MarketingKPI | null;
  trafficData: TrafficDataPoint[];
  trafficSources: TrafficSource[];
  topPages: GA4TopArticle[];
  devices: DeviceBreakdown[];
  countries: CountryBreakdown[];
  leadsTimeline: LeadsTimelinePoint[];
  impressionsTimeline: ImpressionsTimelinePoint[];
  articlesTimeline: ArticleTimelinePoint[];
  source: "ga4" | "mock" | "none";
  ga4Error?: string;
}

export type OverviewPeriod =
  | { kind: "days"; days: 7 | 14 | 30 | 90 | 365 }
  | { kind: "range"; from: string; to: string };

export function useMarketingOverview(period: OverviewPeriod) {
  const query = period.kind === "days"
    ? `period=${period.days}`
    : `from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`;
  const { data, error, isLoading } = useSWR<OverviewResponse>(
    `/api/marketing/overview?${query}`,
    SWR_OPTS,
  );
  return {
    kpis: data?.kpis ?? null,
    trafficData: data?.trafficData ?? [],
    trafficSources: data?.trafficSources ?? [],
    topPages: data?.topPages ?? [],
    devices: data?.devices ?? [],
    countries: data?.countries ?? [],
    leadsTimeline: data?.leadsTimeline ?? [],
    impressionsTimeline: data?.impressionsTimeline ?? [],
    articlesTimeline: data?.articlesTimeline ?? [],
    source: data?.source ?? "none",
    ga4Error: data?.ga4Error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
  };
}

// ─── Marketing events (salons, LinkedIn posts) ──────────────────────────────

interface EventsResponse {
  events: MarketingEvent[];
  error?: string;
}

export function useMarketingEvents() {
  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(
    `/api/marketing/events`,
    SWR_OPTS,
  );

  async function addEvent(input: { event_date: string; event_type: MarketingEventType; label: string }) {
    const res = await fetch("/api/marketing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to add event");
    }
    await mutate();
  }

  async function deleteEvent(id: string) {
    const res = await fetch(`/api/marketing/events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to delete event");
    }
    await mutate();
  }

  return {
    events: data?.events ?? [],
    eventsError: data?.error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
    addEvent,
    deleteEvent,
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

// ─── SEO trends (Winners / Losers) ───────────────────────────────────────────

export function useMarketingSeoTrends(days = 28) {
  const { data, error, isLoading } = useSWR<SeoTrendsResponse>(
    `/api/marketing/seo-trends?days=${days}`,
    SWR_OPTS,
  );
  return {
    winners: (data?.winners ?? []) as PageTrend[],
    losers: (data?.losers ?? []) as PageTrend[],
    seoTrendsError: data?.error ?? null,
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

// ─── LinkedIn Posts Factory ──────────────────────────────────────────────────

interface LinkedInContentResponse {
  analysis: LinkedInContentAnalysis | null;
  recommendations: LinkedInPostRecommendation[];
  drafts: LinkedInPostDraft[];
}

export function useLinkedInContent() {
  const { data, error, isLoading, mutate } = useSWR<LinkedInContentResponse>(
    `/api/marketing/linkedin-content`,
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

// ─── Leads (admin) ───────────────────────────────────────────────────────────

export type LeadsStatusFilter = LeadValidationStatus | "all";
export type LeadsAnalysisFilter =
  | "all"
  | "with_deal"
  | "without_deal"
  | "with_lead"
  | "without_lead"
  | "with_contact";

interface LeadsResponse {
  leads: LeadWithAnalysis[];
  counts: LeadsCounts;
  error?: string;
}

const EMPTY_COUNTS: LeadsCounts = {
  pending: 0,
  validated: 0,
  rejected: 0,
  validatedWithDeal: 0,
  validatedWithoutDeal: 0,
  validatedWithLead: 0,
  validatedWithoutLead: 0,
  validatedWithContact: 0,
};

export function useLeads(status: LeadsStatusFilter, analysis: LeadsAnalysisFilter = "all") {
  const params = new URLSearchParams({ status });
  if (analysis !== "all") params.set("filter", analysis);
  const { data, error, isLoading, mutate } = useSWR<LeadsResponse>(
    `/api/marketing/leads?${params.toString()}`,
    { revalidateOnFocus: false, dedupingInterval: 10_000 },
  );

  async function validateLead(id: string, newStatus: LeadValidationStatus) {
    const res = await fetch("/api/marketing/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to validate lead");
    }
    await mutate();
  }

  async function syncLeads() {
    const res = await fetch("/api/marketing/leads/sync", { method: "POST" });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to sync leads");
    }
    const json = await res.json();
    await mutate();
    return json as { inserted: number };
  }

  async function analyzeLead(id: string) {
    const res = await fetch(`/api/marketing/leads/${id}/analyze`, { method: "POST" });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to analyze lead");
    }
    await mutate();
  }

  async function setLeadSource(id: string, source: string | null) {
    const res = await fetch(`/api/marketing/leads/${id}/source`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err || "Failed to update lead source");
    }
    await mutate();
  }

  async function reanalyzeAll(
    onProgress?: (progress: { processed: number; ok: number; errors: number }) => void,
  ): Promise<{ totalProcessed: number; totalOk: number; totalErrors: number }> {
    // Anchor: only re-treat leads whose last analysis is older than this start
    // timestamp. Prevents infinite loops where leads we just re-analyzed get
    // re-picked because their analyzed_at is now the most recent.
    const olderThan = new Date().toISOString();
    let totalProcessed = 0;
    let totalOk = 0;
    let totalErrors = 0;
    while (true) {
      const res = await fetch(`/api/marketing/leads/backfill-analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25, force: true, olderThan }),
      });
      if (!res.ok) {
        const { error: err } = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err || "Failed to reanalyze");
      }
      const data = (await res.json()) as { processed: number; ok: number; errors: number };
      totalProcessed += data.processed;
      totalOk += data.ok;
      totalErrors += data.errors;
      onProgress?.({ processed: totalProcessed, ok: totalOk, errors: totalErrors });
      if (data.processed === 0) break;
    }
    await mutate();
    return { totalProcessed, totalOk, totalErrors };
  }

  return {
    leads: data?.leads ?? [],
    counts: data?.counts ?? EMPTY_COUNTS,
    leadsError: data?.error ?? null,
    isLoading,
    error: error ? "Loading error" : "",
    validateLead,
    syncLeads,
    analyzeLead,
    setLeadSource,
    reanalyzeAll,
    refresh: () => mutate(),
  };
}

// ─── Leads funnel ────────────────────────────────────────────────────────────

export function useLeadsFunnel() {
  const { data, error, isLoading } = useSWR<LeadsFunnel>(
    `/api/marketing/leads/funnel`,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  return { funnel: data ?? null, isLoading, error: error ? "Loading error" : "" };
}

