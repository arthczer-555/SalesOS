"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/prospecting/client/http";
import type { RepliesListResponse, ReplyDetailResponse, ReplyFilter } from "@/lib/prospecting/replies/shared";

// Vue Replies (lecture seule) : liste filtrée + détail d'une réponse.
export function useProspectingReplies(params: { filter: ReplyFilter; campaignId?: string | null; q?: string; page?: number }) {
  const qs = new URLSearchParams({ filter: params.filter, page: String(params.page ?? 1) });
  if (params.campaignId) qs.set("campaignId", params.campaignId);
  if (params.q) qs.set("q", params.q);
  const { data, error, isLoading, mutate } = useSWR<RepliesListResponse>(`/api/prospecting/replies?${qs.toString()}`, swrFetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
    refreshInterval: 60_000,
  });
  return {
    items: data?.items ?? [],
    counts: data?.counts ?? null,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 50,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
  };
}

export function useReplyDetail(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ReplyDetailResponse>(id ? `/api/prospecting/replies/${id}` : null, swrFetcher, {
    revalidateOnFocus: false,
  });
  return { detail: data ?? null, error: error ? (error as Error).message : null, isLoading, mutate };
}

/** Dernière visite de la vue Replies (badge "nouvelles réponses" de l'onglet). */
export const REPLIES_SEEN_KEY = "pg-replies-seen";
export const REPLIES_SEEN_EVENT = "pg-replies-seen";

export function readRepliesSeen(): string | null {
  try {
    return window.localStorage.getItem(REPLIES_SEEN_KEY);
  } catch {
    return null;
  }
}

export function markRepliesSeen(): void {
  try {
    window.localStorage.setItem(REPLIES_SEEN_KEY, new Date().toISOString());
  } catch {
    // stockage indisponible (navigation privée) : le badge retombe sur "7 derniers jours"
  }
  window.dispatchEvent(new Event(REPLIES_SEEN_EVENT));
}
