import { runAgentJob } from "../../lib/agents/run";

// Background Function : exécute un run d'agent (planifié, "Run now" ou aperçu)
// puis le livre sur Slack. Déclenchée par le dispatcher ou les routes
// /api/agents/[id]/run (x-internal-secret). Body : { runId }.
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[agents-run-bg] unauthorized");
    return;
  }

  let runId: string | undefined;
  try {
    runId = ((await req.json()) as { runId?: string }).runId;
  } catch {
    /* corps invalide */
  }
  if (!runId) {
    console.error("[agents-run-bg] missing runId");
    return;
  }

  const res = await runAgentJob(runId);
  if (!res.ok) console.error(`[agents-run-bg] ${runId} failed:`, res.error);
};
