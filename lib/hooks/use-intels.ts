import useSWRInfinite from "swr/infinite";
import type { Intel, IntelFilters, IntelStats } from "@/lib/intel-types";

interface IntelsResponse {
  intels: Intel[];
  stats: IntelStats;
  nextCursor: number | null;
}

function buildKey(filters: IntelFilters, cursor: number): string {
  const params = new URLSearchParams();
  if (filters.agents?.length) filters.agents.forEach((a) => params.append("agent", a));
  if (filters.scoreMin) params.set("score_min", String(filters.scoreMin));
  if (filters.period && filters.period !== "all") params.set("period", filters.period);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.username) params.set("username", filters.username);
  if (cursor > 0) params.set("cursor", String(cursor));
  return `/api/intel/list?${params.toString()}`;
}

export function useIntels(filters: IntelFilters) {
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<IntelsResponse>(
    (pageIndex, previousPageData) => {
      if (previousPageData && previousPageData.nextCursor === null) return null;
      const cursor = previousPageData?.nextCursor ?? 0;
      return buildKey(filters, cursor);
    },
    {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
      dedupingInterval: 15_000,
      persistSize: false,
    }
  );

  const pages = data ?? [];
  const intels = pages.flatMap((p) => p.intels);
  const stats = pages[0]?.stats ?? { total: 0, unread: 0, actionable: 0 };
  const hasMore = pages.length > 0 ? pages[pages.length - 1].nextCursor !== null : false;
  const isLoadingMore = isValidating && size > 1 && data && typeof data[size - 1] === "undefined";

  return {
    intels,
    stats,
    isLoading,
    isLoadingMore: !!isLoadingMore,
    hasMore,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    loadMore: () => setSize((s) => s + 1),
    reload: () => mutate(),
  };
}

export async function patchIntel(
  id: string,
  patch: Partial<Pick<Intel, "is_read" | "is_actioned" | "archived">>
): Promise<Intel> {
  const res = await fetch(`/api/intel/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH /api/intel/${id} failed`);
  const data = await res.json();
  return data.intel as Intel;
}
