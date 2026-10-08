import type { Context } from "@netlify/functions";
import { runProspectingJob } from "../../lib/prospecting/jobs/run-job";

// Background function : exécute un job Prospecting (génération IA d'une
// séquence pour N prospects, recherche, reveal Apollo, résolution LinkedIn).
// Runtime Background ~15 min. Auth : Bearer CRON_SECRET (triggerBackgroundJob).
// Body : { jobId }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  let jobId = "";
  try {
    jobId = ((await req.json()) as { jobId?: string }).jobId ?? "";
  } catch {
    jobId = "";
  }
  if (!jobId) return new Response("missing jobId", { status: 400 });
  try {
    const res = await runProspectingJob(jobId);
    if (!res.ok) console.error("[prospecting-job-background] failed:", res.error);
  } catch (e) {
    console.error("[prospecting-job-background] unexpected:", e);
  }
  return new Response(null, { status: 200 });
};
