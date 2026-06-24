import useSWR from "swr";
import type { OrgAccount } from "@/lib/orgchart/types";

interface AccountsResponse {
  accounts: OrgAccount[];
}

// Fetcher local qui THROW sur non-2xx (le fetcher global avale les 500).
async function fetcher(url: string): Promise<AccountsResponse> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string })?.error || `HTTP ${r.status}`);
  return d as AccountsResponse;
}

export function useOrgchartAccounts() {
  const { data, error, isLoading, mutate } = useSWR<AccountsResponse>("/api/orgchart/accounts", fetcher);
  return {
    accounts: data?.accounts ?? [],
    isLoading,
    error,
    reload: mutate,
  };
}
