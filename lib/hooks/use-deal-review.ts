import useSWR from "swr";
import type { DealReviewResponse } from "@/lib/deal-review/types";

// Fetcher local : le fetcher global ne lève pas sur un statut non-2xx et
// renverrait un `{ error }` typé à tort en DealReviewResponse.
const fetcher = async (url: string): Promise<DealReviewResponse> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json ? String(json.error) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as DealReviewResponse;
};

/**
 * Dataset du Deal Review admin. Fetch live côté serveur (~2s), on déduplique
 * donc largement et on ne revalide pas au focus.
 */
export function useDealReview() {
  const { data, error, isLoading, mutate } = useSWR<DealReviewResponse>(
    "/api/admin/deal-review",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );

  return {
    data: data ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    reload: () => mutate(),
  };
}
