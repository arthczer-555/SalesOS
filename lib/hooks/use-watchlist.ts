import useSWR from "swr";
import type { WatchSalesRep } from "@/app/api/watchlist/sales-reps/route";
import type { WatchAccount } from "@/app/api/watchlist/accounts/route";

interface RepsResponse {
  reps: WatchSalesRep[];
  error?: string;
}

interface AccountsResponse {
  accounts: WatchAccount[];
  error?: string;
}

export function useWatchSalesReps() {
  const { data, isLoading, mutate } = useSWR<RepsResponse>("/api/watchlist/sales-reps", {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return {
    reps: data?.reps ?? [],
    isLoading,
    error: data?.error ?? null,
    reload: () => mutate(),
  };
}

export function useWatchAccounts(owner: string | null) {
  const key = owner
    ? `/api/watchlist/accounts?owner=${encodeURIComponent(owner)}`
    : "/api/watchlist/accounts";
  const { data, isLoading, mutate } = useSWR<AccountsResponse>(key, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return {
    accounts: data?.accounts ?? [],
    isLoading,
    error: data?.error ?? null,
    reload: () => mutate(),
  };
}
