import useSWR from "swr";
import type { EnrichmentList, EnrichmentProfile, HubspotCriteria } from "@/lib/intel-types";

interface ListsResponse {
  lists: EnrichmentList[];
}

export function useEnrichmentLists() {
  const { data, error, isLoading, mutate } = useSWR<ListsResponse>("/api/intel/enrich/lists", {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return {
    lists: data?.lists ?? [],
    isLoading,
    error: error ? (error instanceof Error ? error.message : "") : "",
    reload: () => mutate(),
  };
}

export async function searchHubspot(
  criteria: HubspotCriteria,
): Promise<{ profiles: EnrichmentProfile[]; hasMore?: boolean }> {
  const r = await fetch("/api/intel/enrich/hubspot-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur HubSpot");
  return data;
}

export async function saveList(input: {
  id?: string;
  name: string;
  source: "hubspot" | "mixed";
  criteria?: unknown;
  results: EnrichmentProfile[];
}): Promise<EnrichmentList> {
  const r = await fetch("/api/intel/enrich/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data.list as EnrichmentList;
}

export async function deleteList(id: string) {
  const r = await fetch(`/api/intel/enrich/lists/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Suppression échouée");
}
