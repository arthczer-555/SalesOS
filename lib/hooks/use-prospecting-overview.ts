"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/prospecting/client/http";
import type { MailboxHealth } from "@/lib/prospecting/types";

export interface ProspectingOverview {
  tasksDue: number | null;
  /** Réponses humaines reçues depuis la dernière visite de Replies (7 j par défaut). */
  repliesNew: number | null;
  campaignsActive: number | null;
  health: MailboxHealth | null;
}

export function useProspectingOverview(repliesSince?: string | null) {
  const key = repliesSince ? `/api/prospecting/overview?repliesSince=${encodeURIComponent(repliesSince)}` : "/api/prospecting/overview";
  const { data, error, isLoading, mutate } = useSWR<ProspectingOverview>(key, swrFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
    dedupingInterval: 10_000,
  });
  return { overview: data ?? null, error: error ? (error as Error).message : null, isLoading, mutate };
}
