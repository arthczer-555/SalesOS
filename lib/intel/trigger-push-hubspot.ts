import { pushListToHubspot } from "./push-list-to-hubspot";
import type { HubspotPushOptions } from "../intel-types";

// Déclenche l'envoi d'une liste vers HubSpot. En prod (Netlify) : POST vers la
// Background Function (le push peut être long : 3-4 appels HubSpot par contact).
// En dev : fire-and-forget inline. Même pattern que triggerPrepareMeetings.
export async function triggerPushHubspot(
  listId: string,
  userId: string,
  origin: string,
  options?: HubspotPushOptions,
): Promise<void> {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    void pushListToHubspot(listId, userId, options).catch((e) =>
      console.error(
        `[intel/trigger-push-hubspot] inline push failed for ${listId}:`,
        e instanceof Error ? e.message : e,
      ),
    );
    return;
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.warn(`[intel/trigger-push-hubspot] missing INTERNAL_SECRET — push for ${listId} not started`);
    return;
  }
  const triggerUrl = `${origin}/.netlify/functions/lists-push-hubspot-background`;

  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id: listId, userId, options }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[intel/trigger-push-hubspot] trigger ${res.status} for ${listId}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[intel/trigger-push-hubspot] trigger fetch failed for ${listId}:`, msg);
    }
  }
}
