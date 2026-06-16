import useSWR from "swr";
import type { AccountChart } from "@/lib/orgchart/types";

// Charge l'organigramme d'un compte (account + people + edges + clusters).
// accountId null -> pas de requête (aucun compte sélectionné).
export function useOrgchart(accountId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AccountChart>(
    accountId ? `/api/orgchart/accounts/${accountId}/chart` : null,
  );
  return {
    account: data?.account ?? null,
    companies: data?.companies ?? [],
    people: data?.people ?? [],
    edges: data?.edges ?? [],
    clusters: data?.clusters ?? [],
    isLoading,
    error,
    reload: mutate,
  };
}
