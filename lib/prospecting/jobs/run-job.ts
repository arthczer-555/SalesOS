// Exécution d'un job Prospecting par type. Idempotent : un job déjà terminé ou
// annulé n'est pas rejoué ; chaque handler persiste sa progression au fil de
// l'eau et peut reprendre (il ne traite que ce qui reste à faire).
import { getJob, updateJob } from "../store/jobs";
import { errMessage, nowIso } from "../store/util";
import type { JobRow } from "../types";
import { runGenerateJob } from "./generate";
import { runApolloRevealJob } from "./apollo-reveal";
import { runLinkedinResolveJob } from "./linkedin-resolve";
import { runResearchJob } from "./research";

const HANDLERS: Record<JobRow["kind"], (job: JobRow) => Promise<Record<string, unknown> | void>> = {
  generate: runGenerateJob,
  apollo_reveal: runApolloRevealJob,
  linkedin_resolve: runLinkedinResolveJob,
  research: runResearchJob,
};

export async function runProspectingJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "done" || job.status === "canceled") return { ok: true };
  await updateJob(job.id, { status: "running" });
  try {
    const result = await HANDLERS[job.kind]({ ...job, status: "running" });
    const fresh = await getJob(job.id);
    if (fresh?.status === "canceled") return { ok: true };
    await updateJob(job.id, { status: "done", result: (result as Record<string, unknown>) ?? null, finished_at: nowIso() });
    return { ok: true };
  } catch (e) {
    const message = errMessage(e);
    console.error(`[prospecting] job ${job.kind} ${job.id} failed:`, message);
    await updateJob(job.id, { status: "error", error: message, finished_at: nowIso() });
    return { ok: false, error: message };
  }
}
