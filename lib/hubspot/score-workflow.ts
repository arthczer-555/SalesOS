// État du workflow HubSpot "[PIPE] 01 – Score to column" de Gaëlle, celui qui
// range une carte selon son score (low / medium / high, puis pipeline Sales à 80).
// Sert à dire la vérité dans les messages : "HubSpot moves the card" seulement
// quand il est allumé. Lecture seule, cache 10 min.

import { hubspotFetch } from "@/lib/hubspot";

/** ID lu le 25/11/2026. Si Gaëlle recrée le workflow, l'état devient "unknown". */
export const SCORE_WORKFLOW_ID = "5398099163";

export type ScoreWorkflowState = "on" | "off" | "unknown";

let cache: { at: number; state: ScoreWorkflowState } | null = null;

export async function getScoreWorkflowState(): Promise<ScoreWorkflowState> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.state;
  let state: ScoreWorkflowState = "unknown";
  try {
    const flow = await hubspotFetch<{ isEnabled?: boolean }>(`/automation/v4/flows/${SCORE_WORKFLOW_ID}`, "GET");
    state = flow.isEnabled === true ? "on" : flow.isEnabled === false ? "off" : "unknown";
  } catch {
    state = "unknown";
  }
  cache = { at: Date.now(), state };
  return state;
}
