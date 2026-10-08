"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/prospecting/client/http";
import type { ProspectListItem } from "@/lib/prospecting/types";

export function useProspects(filters: { q?: string; status?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.status) qs.set("status", filters.status);
  qs.set("page", String(filters.page ?? 1));
  const { data, error, isLoading, mutate } = useSWR<{ items: ProspectListItem[]; total: number; counts: Record<string, number> }>(
    `/api/prospecting/prospects?${qs.toString()}`,
    swrFetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    counts: data?.counts ?? {},
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
  };
}
