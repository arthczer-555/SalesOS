import useSWR from "swr";
import type { AccountChart } from "@/lib/orgchart/types";

// Fetcher local qui THROW sur non-2xx. Le fetcher global SWR avale les 500
// (le JSON {error} devient une "data" valide -> chart vide indiscernable d'un
// compte réellement vide). cf. feedback_swr_fetcher_silent_500.
async function fetcher(url: string): Promise<AccountChart> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string })?.error || `HTTP ${r.status}`);
  return d as AccountChart;
}

// Charge l'organigramme d'un compte (account + people + edges + clusters).
// accountId null -> pas de requête (aucun compte sélectionné).
export function useOrgchart(accountId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AccountChart>(
    accountId ? `/api/orgchart/accounts/${accountId}/chart` : null,
    fetcher,
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
