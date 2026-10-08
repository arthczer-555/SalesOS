"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { LeadInput, LeadListItem, PrecheckSummary } from "@/lib/prospecting/types";

export interface LeadFilters {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useCampaignLeads(campaignId: string | null, filters: LeadFilters) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.q) qs.set("q", filters.q);
  qs.set("page", String(filters.page ?? 1));
  qs.set("pageSize", String(filters.pageSize ?? 50));
  const key = campaignId ? `/api/prospecting/campaigns/${campaignId}/leads?${qs.toString()}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ items: LeadListItem[]; total: number }>(key, swrFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    refreshInterval: (d) => (d?.items.some((i) => i.enrollment.content_status === "queued" || i.enrollment.content_status === "generating") ? 4_000 : 30_000),
  });

  const bulk = useCallback(
    async (ids: string[], action: string) => {
      const res = await sendJson<{ updated: number; errors: string[] }>("/api/prospecting/enrollments/bulk", "POST", { ids, action });
      void mutate();
      return res;
    },
    [mutate],
  );

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    bulk,
  };
}

export async function precheckLeads(campaignId: string, leads: LeadInput[]) {
  return sendJson<{ summary: PrecheckSummary }>(`/api/prospecting/campaigns/${campaignId}/leads`, "POST", { leads, dryRun: true });
}

export async function addLeads(
  campaignId: string,
  leads: LeadInput[],
  options: { includeRecentlyContacted?: boolean; includeExistingClients?: boolean; includeMissingEmail?: boolean; excludeIndexes?: number[] },
) {
  return sendJson<{ added: number; skipped: number; summary: PrecheckSummary }>(`/api/prospecting/campaigns/${campaignId}/leads`, "POST", { leads, options });
}
