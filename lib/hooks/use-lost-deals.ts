import useSWRInfinite from "swr/infinite";
import type { LostDeal } from "@/app/deals/_helpers";

interface LostDealsPage {
  deals: LostDeal[];
  nextAfter: string | null;
  total: number;
  error: string | null;
}

export type LostSort = "lost" | "reopen";

// Colonne "Closed lost" du board : pages de 30 deals (/api/deals/lost), la
// suivante chargée par "Show older". Tri par date de perte ou de relance (la
// recherche texte impose le tri par date de perte, cf. la route).
export function useLostDeals(searchQuery: string, ownerFilter: "mine" | "all", sort: LostSort = "lost") {
  const getKey = (index: number, prev: LostDealsPage | null) => {
    if (prev && !prev.nextAfter) return null;
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (ownerFilter === "all") params.set("owner", "all");
    if (sort === "reopen") params.set("sort", "reopen");
    if (index > 0 && prev?.nextAfter) params.set("after", prev.nextAfter);
    return `/api/deals/lost?${params.toString()}`;
  };

  const { data, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<LostDealsPage>(getKey, {
    revalidateOnFocus: false,
    revalidateFirstPage: false,
  });

  const pages = data ?? [];
  const last = pages[pages.length - 1];
  return {
    deals: pages.flatMap((p) => p.deals ?? []),
    total: pages[0]?.total ?? 0,
    hasMore: !!last?.nextAfter,
    loadingMore: isValidating && size > pages.length,
    loadMore: () => setSize(size + 1),
    isLoading,
    error: pages.find((p) => p.error)?.error ?? "",
    reload: () => mutate(),
  };
}
