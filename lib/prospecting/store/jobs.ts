// Jobs background Prospecting (génération IA, recherche, reveal Apollo,
// résolution LinkedIn). Une ligne prospecting_jobs, exécutée par la Background
// Function prospecting-job-background (ou in-process en dev), pollée par l'UI.
import { db } from "@/lib/db";
import { triggerBackgroundJob } from "@/lib/orgchart/dispatch-job";
import type { JobKind, JobProgress, JobRow } from "../types";
import { nowIso } from "./util";

export async function createJob(input: {
  userId: string;
  kind: JobKind;
  campaignId?: string | null;
  params?: Record<string, unknown>;
  total?: number;
  label?: string;
}): Promise<JobRow> {
  const { data, error } = await db
    .from("prospecting_jobs")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      campaign_id: input.campaignId ?? null,
      params: input.params ?? {},
      status: "queued",
      progress: { total: input.total ?? 0, done: 0, errors: 0, label: input.label },
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as JobRow;
}

export async function getJob(jobId: string): Promise<JobRow | null> {
  const { data } = await db.from("prospecting_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function updateJob(
  jobId: string,
  patch: Partial<Pick<JobRow, "status" | "result" | "error" | "finished_at">> & { progress?: JobProgress },
): Promise<void> {
  const { error } = await db
    .from("prospecting_jobs")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", jobId);
  if (error) console.error("[prospecting] job update failed:", error.message);
}

export async function isJobCanceled(jobId: string): Promise<boolean> {
  const { data } = await db.from("prospecting_jobs").select("status").eq("id", jobId).maybeSingle();
  return data?.status === "canceled";
}

/** Job en cours du même type sur la campagne (évite les doublons de génération). */
export async function findRunningJob(campaignId: string, kind: JobKind): Promise<JobRow | null> {
  const { data } = await db
    .from("prospecting_jobs")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

/** Déclenche l'exécution du job (Background Function sur Netlify, after() en dev). */
export async function dispatchJob(job: JobRow, origin: string): Promise<void> {
  await triggerBackgroundJob({
    jobId: job.id,
    fnName: "prospecting-job-background",
    table: "prospecting_jobs",
    origin,
    run: async () => {
      const { runProspectingJob } = await import("../jobs/run-job");
      return runProspectingJob(job.id);
    },
  });
}
