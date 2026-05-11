import useSWR from "swr";
import type { Intel, IntelFilters, IntelStats } from "@/lib/intel-types";

interface IntelsResponse {
  intels: Intel[];
  stats: IntelStats;
  nextCursor: number | null;
}

function buildKey(filters: IntelFilters): string {
  const params = new URLSearchParams();
  if (filters.agents?.length) filters.agents.forEach((a) => params.append("agent", a));
  if (filters.scoreMin) params.set("score_min", String(filters.scoreMin));
  if (filters.period && filters.period !== "all") params.set("period", filters.period);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.username) params.set("username", filters.username);
  return `/api/intel/list?${params.toString()}`;
}

export function useIntels(filters: IntelFilters) {
  const { data, error, isLoading, mutate } = useSWR<IntelsResponse>(buildKey(filters), {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  return {
    intels: data?.intels ?? [],
    stats: data?.stats ?? { total: 0, unread: 0, actionable: 0 },
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
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
