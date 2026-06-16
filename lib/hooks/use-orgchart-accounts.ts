import useSWR from "swr";
import type { OrgAccount } from "@/lib/orgchart/types";

interface AccountsResponse {
  accounts: OrgAccount[];
}

export function useOrgchartAccounts() {
  const { data, error, isLoading, mutate } = useSWR<AccountsResponse>("/api/orgchart/accounts");
  return {
    accounts: data?.accounts ?? [],
    isLoading,
    error,
    reload: mutate,
  };
}
