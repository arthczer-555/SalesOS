import { useRef } from "react";
import useSWR from "swr";

interface EnrichJob {
  id: string;
  status: "running" | "done" | "error";
  summary: { revealed?: number; created?: number; existing?: number; no_email?: number } | null;
  error: string | null;
}

interface Opts {
  onDone?: (job: EnrichJob) => void;
  onError?: (job: EnrichJob) => void;
}

const POLL_MS = 1500;
const MAX_RUNNING_MS = 8 * 60_000;

// Fetcher qui THROW sur non-2xx (le fetcher global avale les 500).
async function fetcher(url: string): Promise<{ job: EnrichJob }> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string })?.error || `HTTP ${r.status}`);
  return d as { job: EnrichJob };
}

// Poll d'un job d'enrichissement Apollo (réutilise la route apollo existante).
export function useApolloEnrichJob(jobId: string | null, opts?: Opts) {
  const tracker = useRef<{ jobId: string | null; status: string | null; startedAt: number; fired: boolean }>({
    jobId: null,
    status: null,
    startedAt: 0,
    fired: false,
  });

  const fire = (job: EnrichJob) => {
    if (tracker.current.fired) return;
    tracker.current.fired = true;
    tracker.current.status = job.status;
    if (job.status === "done") opts?.onDone?.(job);
    else opts?.onError?.(job);
  };

  const { data } = useSWR<{ job: EnrichJob }>(jobId ? `/api/apollo/enrich/${jobId}` : null, fetcher, {
    refreshInterval: (d) => (d?.job?.status === "running" ? POLL_MS : 0),
    revalidateOnFocus: false,
    onSuccess: (d) => {
      if (tracker.current.jobId !== jobId) {
        tracker.current = { jobId, status: null, startedAt: Date.now(), fired: false };
      }
      const job = d?.job;
      if (!job) return;
      if (job.status === "running" && Date.now() - tracker.current.startedAt > MAX_RUNNING_MS) {
        fire({ ...job, status: "error", error: "Timed out — still running in the background, refresh later." });
        return;
      }
      if (job.status !== "running" && job.status !== tracker.current.status) fire(job);
    },
    onError: (err: Error) => {
      if (tracker.current.jobId !== jobId) {
        tracker.current = { jobId, status: null, startedAt: Date.now(), fired: false };
      }
      fire({ id: jobId ?? "", status: "error", summary: null, error: err?.message ?? "Polling failed" });
    },
  });

  return { job: data?.job ?? null };
}
