"use client";

// Tâches manuelles Prospecting (LinkedIn, appels, tâches libres) : liste par
// échéance + actions (fait / issue, sauter, reporter) avec mise à jour optimiste.
import { useCallback } from "react";
import useSWR from "swr";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { TaskBucket, TaskKindFilter, TaskListItem, TaskOutcome, TasksResponse, TouchRow } from "@/lib/prospecting/types";

export interface TaskFilters {
  kind?: TaskKindFilter | null;
  campaignId?: string | null;
  buckets?: TaskBucket[];
}

export function tasksKey(filters: TaskFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.buckets?.length) qs.set("bucket", filters.buckets.join(","));
  if (filters.kind) qs.set("kind", filters.kind);
  if (filters.campaignId) qs.set("campaignId", filters.campaignId);
  const s = qs.toString();
  return `/api/prospecting/tasks${s ? `?${s}` : ""}`;
}

const EMPTY_COUNTS: TasksResponse["counts"] = { overdue: 0, today: 0, upcoming: 0, doneToday: 0 };

export function useProspectingTasks(filters: TaskFilters = {}) {
  const key = tasksKey(filters);
  const { data, error, isLoading, mutate } = useSWR<TasksResponse>(key, swrFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  // Retire la tâche de la liste tout de suite ; la revalidation remet l'état serveur.
  const optimisticClose = useCallback(
    (id: string, next: (item: TaskListItem) => TaskListItem | null) =>
      mutate(
        (cur) => {
          if (!cur) return cur;
          const items: TaskListItem[] = [];
          for (const it of cur.items) {
            if (it.touch.id !== id) {
              items.push(it);
              continue;
            }
            const replaced = next(it);
            if (replaced) items.push(replaced);
          }
          return { ...cur, items };
        },
        { revalidate: false },
      ),
    [mutate],
  );

  const complete = useCallback(
    async (id: string, outcome: TaskOutcome = "done", note?: string) => {
      await optimisticClose(id, (it) => ({ ...it, bucket: "done", touch: { ...it.touch, status: "done", task_outcome: outcome } }));
      try {
        return await sendJson<{ touch: TouchRow }>(`/api/prospecting/tasks/${id}/complete`, "POST", { outcome, note });
      } finally {
        await mutate();
      }
    },
    [mutate, optimisticClose],
  );

  const skip = useCallback(
    async (id: string, note?: string) => {
      await optimisticClose(id, (it) => ({ ...it, bucket: "done", touch: { ...it.touch, status: "skipped" } }));
      try {
        return await sendJson<{ touch: TouchRow }>(`/api/prospecting/tasks/${id}/skip`, "POST", { note });
      } finally {
        await mutate();
      }
    },
    [mutate, optimisticClose],
  );

  const snooze = useCallback(
    async (id: string, until: Date) => {
      await optimisticClose(id, (it) => ({ ...it, bucket: "upcoming", estimatedAt: until.toISOString() }));
      try {
        return await sendJson<{ touch: TouchRow }>(`/api/prospecting/tasks/${id}/snooze`, "POST", { until: until.toISOString() });
      } finally {
        await mutate();
      }
    },
    [mutate, optimisticClose],
  );

  return {
    items: data?.items ?? [],
    counts: data?.counts ?? EMPTY_COUNTS,
    hasData: !!data,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    isLoading,
    mutate,
    complete,
    skip,
    snooze,
  };
}
