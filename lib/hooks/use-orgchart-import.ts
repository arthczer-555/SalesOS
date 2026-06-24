import { useRef } from "react";
import useSWR from "swr";
import type { ImportResult, JobProgress } from "@/lib/orgchart/types";

interface ImportJob {
  id: string;
  source: "csv" | "hubspot" | "reorganize" | "hubspot_sync" | "hubspot_refresh";
  status: "running" | "done" | "error";
  account_id: string | null;
  result: ImportResult | null;
  progress: JobProgress | null;
  error: string | null;
}

interface Opts {
  onDone?: (job: ImportJob) => void;
  onError?: (job: ImportJob) => void;
  // Le job tourne encore au-delà du soft-timeout : ce n'est PAS un échec (la
  // Background Function continue). On notifie une fois et on continue de poller.
  onTimeout?: (job: ImportJob) => void;
}

const POLL_MS = 1500;
// Soft : on prévient que c'est long mais on continue (le onDone réel reste
// atteignable, avec ses proposals HubSpot). Hard : on abandonne le polling
// client (le job pourra être consulté plus tard). cf. B5.
const SOFT_TIMEOUT_MS = 10 * 60_000;
const HARD_TIMEOUT_MS = 20 * 60_000;

// Fetcher qui THROW sur non-2xx (le fetcher global SWR avale les 500, ce qui
// laissait l'UI bloquée). cf. feedback_swr_fetcher_silent_500.
async function fetcher(url: string): Promise<{ job: ImportJob }> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string })?.error || `HTTP ${r.status}`);
  return d as { job: ImportJob };
}

// Poll d'un job d'import / reorganize / refresh / sync. onDone/onError sont
// déclenchés UNE fois (transition de statut, timeout, ou erreur de polling).
export function useOrgImportJob(jobId: string | null, opts?: Opts) {
  const tracker = useRef<{ jobId: string | null; status: string | null; startedAt: number; fired: boolean; timedOut: boolean }>({
    jobId: null,
    status: null,
    startedAt: 0,
    fired: false,
    timedOut: false,
  });

  const fire = (job: ImportJob) => {
    if (tracker.current.fired) return;
    tracker.current.fired = true;
    tracker.current.status = job.status;
    if (job.status === "done") opts?.onDone?.(job);
    else opts?.onError?.(job);
  };

  const { data } = useSWR<{ job: ImportJob }>(jobId ? `/api/orgchart/accounts/import/${jobId}` : null, fetcher, {
    refreshInterval: (d) => (d?.job?.status === "running" ? POLL_MS : 0),
    revalidateOnFocus: false,
    onSuccess: (d) => {
      if (tracker.current.jobId !== jobId) {
        tracker.current = { jobId, status: null, startedAt: Date.now(), fired: false, timedOut: false };
      }
      const job = d?.job;
      if (!job) return;
      if (job.status === "running") {
        const elapsed = Date.now() - tracker.current.startedAt;
        if (elapsed > HARD_TIMEOUT_MS) {
          // Abandon réel du polling client (le job tourne peut-être encore).
          fire({ ...job, status: "error", error: "Still running in the background. Refresh later to see the result." });
        } else if (elapsed > SOFT_TIMEOUT_MS && !tracker.current.timedOut) {
          tracker.current.timedOut = true;
          opts?.onTimeout?.(job); // notif douce, on NE coupe PAS le polling
        }
        return;
      }
      if (job.status !== tracker.current.status) fire(job);
    },
    onError: (err: Error) => {
      if (tracker.current.jobId !== jobId) {
        tracker.current = { jobId, status: null, startedAt: Date.now(), fired: false, timedOut: false };
      }
      fire({ id: jobId ?? "", source: "hubspot", status: "error", account_id: null, result: null, progress: null, error: err?.message ?? "Polling failed" });
    },
  });

  return { job: data?.job ?? null };
}
