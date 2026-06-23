import useSWR from "swr";
import type {
  AnyMeetingKind,
  AnySalesCoachAnalysis,
} from "@/lib/guides/sales-coach";
import type { DealSnapshot, CompanyMatchSnapshot } from "@/lib/hubspot";
import type { TalkRatio } from "@/lib/sales-coach/talk-ratio";

export type Audience = "prospect" | "client";

// Custom fetcher: SWR's default fetcher resolves with the JSON body even for
// 4xx/5xx responses, which means errorRetryCount/Interval never kick in. By
// throwing on non-OK we let SWR drive retries (notably for 404 race conditions
// right after an analysis is freshly created).
async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

const SWR_OPTS = {
  fetcher: jsonFetcher,
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
} as const;

export type SalesCoachStatus =
  | "pending"
  | "analyzing"
  | "done"
  | "error"
  | "skipped"
  | "awaiting_manual_deal";

export type MeetingParticipant = {
  name: string | null;
  email: string;
  attended: boolean | null;
};

export interface SalesCoachListItem {
  id: string;
  claap_recording_id: string;
  user_id: string | null;
  recorder_email: string;
  hubspot_deal_id: string | null;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_type: string | null;
  meeting_kind: AnyMeetingKind | null;
  audience: Audience | null;
  status: SalesCoachStatus;
  score_global: number | null;
  slack_sent_at: string | null;
  created_at: string;
  error_message: string | null;
  participants: MeetingParticipant[] | null;
  primary_contact: { name: string; email: string } | null;
}

export interface SalesCoachDetail extends SalesCoachListItem {
  transcript_text: string | null;
  analysis: AnySalesCoachAnalysis | null;
  deal_snapshot: DealSnapshot | null;
  hubspot_company_id: string | null;
  company_snapshot: CompanyMatchSnapshot | null;
  talk_ratio: TalkRatio | null;
  email_draft: { subject: string; body: string; generated_at: string } | null;
  claap_event_id: string | null;
  updated_at: string;
}

interface ListResponse {
  analyses: SalesCoachListItem[];
  isAdmin: boolean;
}

export function useSalesCoachList(
  ownerFilter: "mine" | "all" = "mine",
  dateRange?: { from?: string; to?: string },
) {
  const params = new URLSearchParams();
  if (ownerFilter === "all") params.set("owner", "all");
  if (dateRange?.from) params.set("from", dateRange.from);
  if (dateRange?.to) params.set("to", dateRange.to);
  const qs = params.toString();
  const key = `/api/sales-coach/list${qs ? `?${qs}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(key, {
    ...SWR_OPTS,
    // Poll every 5s while any row is still pending/analyzing — stops polling
    // once all rows reach a terminal state (done/error/skipped).
    refreshInterval: (latest) => {
      const hasInFlight = (latest?.analyses ?? []).some(
        (a) => a.status === "pending" || a.status === "analyzing",
      );
      return hasInFlight ? 5000 : 0;
    },
  });
  return {
    analyses: data?.analyses ?? [],
    isAdmin: data?.isAdmin ?? false,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    reload: () => mutate(),
  };
}

interface DetailResponse {
  analysis: SalesCoachDetail;
}

export function useSalesCoachDetail(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<DetailResponse>(
    id ? `/api/sales-coach/${id}` : null,
    {
      ...SWR_OPTS,
      // Retry on 404: a freshly backfilled or webhook-created row may not be
      // committed yet by the time the client first fetches it. 4 retries with
      // exponential-ish backoff covers the typical replication window.
      shouldRetryOnError: true,
      errorRetryCount: 4,
      errorRetryInterval: 1500,
      refreshInterval: (latest) => {
        const s = latest?.analysis?.status;
        return s === "pending" || s === "analyzing" ? 5000 : 0;
      },
    },
  );
  return {
    detail: data?.analysis ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    reload: () => mutate(),
  };
}

export function useSalesCoachDealHistory(dealId: string | null, excludeId?: string | null) {
  const key = dealId ? `/api/sales-coach/list?deal=${encodeURIComponent(dealId)}&owner=all` : null;
  const { data, error, isLoading } = useSWR<ListResponse>(key, SWR_OPTS);
  const analyses = (data?.analyses ?? []).filter((a) => !excludeId || a.id !== excludeId);
  return {
    history: analyses,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
  };
}

export type TrendPoint = {
  id: string;
  title: string | null;
  date: string | null;
  meeting_kind: string | null;
  score_global: number | null;
  axes: {
    opening: number;
    discovery: number;
    active_listening: number;
    value_articulation: number;
    objection_handling: number;
    next_steps: number;
  } | null;
  meddic: {
    metrics: number;
    economic_buyer: number;
    decision_criteria: number;
    decision_process: number;
    identify_pain: number;
    champion: number;
  } | null;
};

export type MeetingRecapPayload = {
  context: string;
  need: string;
  risks_competition: string;
  opportunities: string;
  next_steps: string;
};

export interface SalesCoachRecapItem {
  id: string;
  user_id: string | null;
  hubspot_deal_id: string | null;
  meeting_title: string | null;
  meeting_started_at: string | null;
  audience: "prospect" | "client" | null;
  meeting_recap: MeetingRecapPayload | null;
  meeting_recap_slack_text: string | null;
  meeting_recap_slack_permalink: string | null;
  meeting_recap_slack_sent_at: string | null;
  meeting_recap_slack_recipients: string[] | null;
  created_at: string;
  company: string | null;
  primary_contact: { name: string; email: string } | null;
  participants: MeetingParticipant[] | null;
}

interface RecapsListResponse {
  recaps: SalesCoachRecapItem[];
  isAdmin: boolean;
}

export function useSalesCoachRecaps(
  audience: "all" | "prospect" | "client" = "all",
  dateRange?: { from?: string; to?: string },
) {
  const params = new URLSearchParams();
  if (audience !== "all") params.set("audience", audience);
  if (dateRange?.from) params.set("from", dateRange.from);
  if (dateRange?.to) params.set("to", dateRange.to);
  const qs = params.toString();
  const key = `/api/sales-coach/recaps/list${qs ? `?${qs}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<RecapsListResponse>(key, SWR_OPTS);
  return {
    recaps: data?.recaps ?? [],
    isAdmin: data?.isAdmin ?? false,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    reload: () => mutate(),
  };
}

export function useSalesCoachTrends(args: { dealId?: string | null; excludeId?: string | null; limit?: number }) {
  const { dealId, excludeId, limit = 5 } = args;
  const params = new URLSearchParams();
  if (dealId) params.set("dealId", dealId);
  else params.set("scope", "mine");
  if (excludeId) params.set("excludeId", excludeId);
  params.set("limit", String(limit));
  const key = `/api/sales-coach/trends?${params.toString()}`;

  const { data, error, isLoading } = useSWR<{ trends: TrendPoint[] }>(key, SWR_OPTS);
  return {
    trends: data?.trends ?? [],
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
  };
}
