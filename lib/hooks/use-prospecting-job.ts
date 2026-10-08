"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { JobRow } from "@/lib/prospecting/types";

const LIVE = new Set(["queued", "running"]);

/** Suit un job background jusqu'à la fin (poll 2 s). */
export function useProspectingJob(jobId: string | null) {
  const { data, error, mutate } = useSWR<{ job: JobRow }>(jobId ? `/api/prospecting/jobs/${jobId}` : null, swrFetcher, {
    revalidateOnFocus: false,
    refreshInterval: (d) => (d && !LIVE.has(d.job.status) ? 0 : 2_000),
  });
  const cancel = useCallback(async () => {
    if (!jobId) return;
    await sendJson(`/api/prospecting/jobs/${jobId}/cancel`, "POST");
    void mutate();
  }, [jobId, mutate]);
  const job = data?.job ?? null;
  return { job, running: !!job && LIVE.has(job.status), error: error ? (error as Error).message : null, cancel };
}
