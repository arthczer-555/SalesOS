import * as React from "react";
import useSWR from "swr";
import type { WatchCompanyDetailResponse } from "@/app/api/watchlist/companies/[id]/route";
import type { BriefsResponse } from "@/app/api/watchlist/companies/[id]/briefs/route";
import type { BriefKind, AeTarget } from "@/lib/watchlist/briefs";

const EMPTY_BRIEFS = { ae_analysis: null, news: null } as const;

export function useWatchCompanyDetail(id: string | null) {
  const key = id ? `/api/watchlist/companies/${id}` : null;
  const { data, isLoading, mutate, error: fetchError } = useSWR<WatchCompanyDetailResponse>(key, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  return {
    company: data?.company ?? null,
    prospects: data?.prospects ?? [],
    briefs: data?.briefs ?? EMPTY_BRIEFS,
    outreach_count: data?.outreach_count ?? 0,
    isLoading,
    error: data?.error ?? (fetchError instanceof Error ? fetchError.message : null),
    reload: () => mutate(),
  };
}

// Au-delà de cette durée sans que le brief sorte de "running", on cesse de
// poller : le job fire-and-forget a probablement échoué sans écrire son statut
// (crash, crédit Claude épuisé). Évite un polling perpétuel toutes les 3s.
const POLL_MAX_MS = 4 * 60_000;

/**
 * Poll /briefs toutes les 3s tant que `isRunning` est true, avec un garde-fou de
 * durée. Chaque tick déclenche un refresh du payload détaillé (via la callback).
 * `runToken` doit changer à chaque nouvelle génération pour réarmer le minuteur.
 * Renvoie `{ briefs, stalled }` ; `stalled` = le job semble bloqué (timeout).
 */
export function useBriefsPolling(id: string | null, isRunning: boolean, onTick?: () => void, runToken?: number) {
  const [stalled, setStalled] = React.useState(false);
  const startedRef = React.useRef<number | null>(null);

  // (Ré)arme le minuteur quand une génération démarre ou qu'un nouveau run est
  // déclenché ; le désarme à l'arrêt.
  React.useEffect(() => {
    startedRef.current = isRunning ? Date.now() : null;
    setStalled(false);
  }, [isRunning, runToken]);

  const active = isRunning && !stalled;
  const key = id && active ? `/api/watchlist/companies/${id}/briefs` : null;
  const { data } = useSWR<BriefsResponse>(key, {
    refreshInterval: active ? 3000 : 0,
    revalidateOnFocus: false,
    onSuccess: () => {
      if (startedRef.current && Date.now() - startedRef.current > POLL_MAX_MS) {
        setStalled(true);
        return;
      }
      if (onTick) onTick();
    },
  });
  return { briefs: data?.briefs ?? EMPTY_BRIEFS, stalled };
}

export async function patchCompanyNotes(
  id: string,
  notes: string | null,
): Promise<{ ok: boolean; notes: string | null; error?: string }> {
  const res = await fetch(`/api/watchlist/companies/${id}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return res.json();
}

/**
 * Hook React pour déclencher la régénération d'un brief. Gère le loading
 * (`isRefreshing`) et expose l'erreur la plus récente.
 *
 * - News : POST inline, ~3-5s avec spinner.
 * - Analyse AE : POST 202 fire-and-forget. La page poll ensuite via
 *   useBriefsPolling et useWatchCompanyDetail.reload().
 */
export function useBriefRefresh(id: string | null, onComplete?: () => void) {
  const [isRefreshing, setIsRefreshing] = React.useState<Record<BriefKind, boolean>>({
    ae_analysis: false,
    news: false,
  });
  const [errorByKind, setErrorByKind] = React.useState<Partial<Record<BriefKind, string>>>({});

  const refresh = React.useCallback(
    async (kind: BriefKind, options?: { withMessages?: boolean; targets?: AeTarget[] }) => {
      if (!id) return;
      setIsRefreshing((prev) => ({ ...prev, [kind]: true }));
      setErrorByKind((prev) => ({ ...prev, [kind]: undefined }));
      try {
        const res = await fetch(`/api/watchlist/companies/${id}/briefs/${kindToPath(kind)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options ?? {}),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok && !json?.alreadyRunning) {
          setErrorByKind((prev) => ({ ...prev, [kind]: json?.error ?? `Error ${res.status}` }));
        }
        if (onComplete) onComplete();
      } catch (e) {
        setErrorByKind((prev) => ({
          ...prev,
          [kind]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setIsRefreshing((prev) => ({ ...prev, [kind]: false }));
      }
    },
    [id, onComplete],
  );

  return { refresh, isRefreshing, errorByKind };
}

function kindToPath(kind: BriefKind): string {
  if (kind === "ae_analysis") return "ae-analysis";
  return "news";
}
