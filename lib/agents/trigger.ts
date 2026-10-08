import { runAgentJob } from "./run";
import { runAgentDesign } from "./design";

// Déclencheurs des jobs d'agents : Background Function Netlify en prod (le
// design + aperçu ou un run enchaînent plusieurs appels IA, 20 s à 3 min),
// inline en local où les background functions n'existent pas. Fire-and-forget :
// l'éditeur suit l'avancement par polling.

function isNetlify(): boolean {
  return !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
}

async function fireBackground(origin: string, fn: string, body: Record<string, unknown>): Promise<void> {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) throw new Error("INTERNAL_SECRET missing");
  try {
    const res = await fetch(`${origin}/.netlify/functions/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(`${fn} trigger HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Timeout = la background function a bien été lancée, elle répond juste lentement.
    if (msg.includes("aborted") || msg.includes("timeout")) return;
    throw e;
  }
}

export async function triggerAgentRun(origin: string, runId: string): Promise<void> {
  if (!isNetlify()) {
    void runAgentJob(runId).catch((e) => console.error(`[agents/run/${runId}] inline failed:`, e));
    return;
  }
  await fireBackground(origin, "agents-run-background", { runId });
}

export async function triggerAgentDesign(
  origin: string,
  agentId: string,
  opts: { feedback?: string; keepName?: boolean; keepSchedule?: boolean },
): Promise<void> {
  if (!isNetlify()) {
    void runAgentDesign(agentId, opts).catch((e) => console.error(`[agents/design/${agentId}] inline failed:`, e));
    return;
  }
  await fireBackground(origin, "agents-design-background", { agentId, ...opts });
}
