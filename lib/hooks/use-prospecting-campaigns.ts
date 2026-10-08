"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { CampaignListItem, CampaignRow, StepDraft } from "@/lib/prospecting/types";

export function useProspectingCampaigns(opts: { archived?: boolean } = {}) {
  const key = opts.archived ? "/api/prospecting/campaigns?archived=1" : "/api/prospecting/campaigns";
  const { data, error, isLoading, mutate } = useSWR<{ campaigns: CampaignListItem[]; statsError: string | null }>(key, swrFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
    refreshInterval: 60_000,
  });

  const create = useCallback(
    async (input: { name: string; personaId?: string | null; templateKey?: string | null; steps?: StepDraft[]; goal?: string; sourceListId?: string | null }) => {
      const res = await sendJson<{ campaign: CampaignRow }>("/api/prospecting/campaigns", "POST", input);
      void mutate();
      return res.campaign;
    },
    [mutate],
  );

  return {
    campaigns: data?.campaigns ?? [],
    statsError: data?.statsError ?? null,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    create,
  };
}
