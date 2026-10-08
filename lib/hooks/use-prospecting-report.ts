"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/prospecting/client/http";
import type { CampaignReport } from "@/lib/prospecting/types";

export function useCampaignReport(campaignId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CampaignReport>(
    campaignId ? `/api/prospecting/campaigns/${campaignId}/report` : null,
    swrFetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 },
  );
  return { report: data ?? null, error: error ? (error as Error).message : null, isLoading, mutate };
}
