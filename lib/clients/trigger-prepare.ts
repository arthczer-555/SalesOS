import { prepareMeetingConfirmation } from "./prepare-meetings";

// Déclenche la préparation de la confirmation des meetings (discovery + passage
// en 'awaiting_meetings' + DM Slack). En prod (Netlify) : POST vers la
// Background Function pour le runtime long (scan Claap). En dev : fire-and-forget
// inline. Même pattern que triggerEnrichmentBackground côté webhook.
//
// `origin` : base URL pour joindre la Background Function (req.nextUrl.origin).
export async function triggerPrepareMeetings(clientId: string, origin: string): Promise<void> {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    void prepareMeetingConfirmation(clientId).catch((e) =>
      console.error(
        `[clients/trigger-prepare] inline prepare failed for ${clientId}:`,
        e instanceof Error ? e.message : e,
      ),
    );
    return;
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.warn(`[clients/trigger-prepare] missing INTERNAL_SECRET — prepare for ${clientId} not started`);
    return;
  }
  const triggerUrl = `${origin}/.netlify/functions/clients-prepare-meetings-background`;

  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id: clientId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[clients/trigger-prepare] trigger ${res.status} for ${clientId}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[clients/trigger-prepare] trigger fetch failed for ${clientId}:`, msg);
    }
  }
}
