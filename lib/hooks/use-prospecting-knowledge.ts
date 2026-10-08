"use client";

import useSWR from "swr";
import { useCallback, useState } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { KnowledgeListItem } from "@/lib/prospecting/ai/types";
import type { KnowledgeRow, PersonaMessaging } from "@/lib/prospecting/types";

export interface KnowledgeSyncProgress {
  total: number;
  done: number;
  failed: number;
  current: string | null;
}

/** Base de connaissance Coachello (snapshot Notion) + synchronisation page par page. */
export function useKnowledge() {
  const { data, error, isLoading, mutate } = useSWR<{ pages: KnowledgeListItem[] }>("/api/prospecting/knowledge", swrFetcher, {
    revalidateOnFocus: false,
  });
  const [progress, setProgress] = useState<KnowledgeSyncProgress | null>(null);

  // Une requête par page : progression réelle et aucune route ne dépasse sa durée max.
  const sync = useCallback(
    async (pageIds?: string[]): Promise<{ synced: number; failed: number }> => {
      const pages = data?.pages ?? [];
      const ids = pageIds?.length ? pageIds : pages.map((p) => p.id);
      const titles = new Map(pages.map((p) => [p.id, p.title]));
      let done = 0;
      let failed = 0;
      setProgress({ total: ids.length, done, failed, current: titles.get(ids[0]) ?? null });
      try {
        if (!ids.length) {
          const res = await sendJson<{ pages: KnowledgeRow[] }>("/api/prospecting/knowledge/sync", "POST", {});
          failed = res.pages.filter((p) => p.error).length;
          return { synced: res.pages.length - failed, failed };
        }
        for (const id of ids) {
          setProgress({ total: ids.length, done, failed, current: titles.get(id) ?? id });
          try {
            const res = await sendJson<{ pages: KnowledgeRow[] }>("/api/prospecting/knowledge/sync", "POST", { pageIds: [id] });
            if (res.pages.some((p) => p.error)) failed++;
          } catch {
            failed++;
          }
          done++;
        }
        return { synced: done - failed, failed };
      } finally {
        setProgress(null);
        void mutate();
      }
    },
    [data, mutate],
  );

  const distill = useCallback(async (personaId: string) => {
    return sendJson<{ messaging: PersonaMessaging; dropped: string[] }>("/api/prospecting/knowledge/distill", "POST", { personaId });
  }, []);

  return {
    pages: data?.pages ?? [],
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    sync,
    syncing: progress !== null,
    progress,
    distill,
  };
}

/** Contenu complet d'une page synchronisée. */
export function useKnowledgePage(id: string | null) {
  const { data, error, isLoading } = useSWR<{ page: KnowledgeRow }>(id ? `/api/prospecting/knowledge/${encodeURIComponent(id)}` : null, swrFetcher, {
    revalidateOnFocus: false,
  });
  return { page: data?.page ?? null, error: error ? (error as Error).message : null, isLoading };
}
