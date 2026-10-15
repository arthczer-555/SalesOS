/**
 * Champs à remettre à zéro pour que les 2 DM Slack (debrief coaching + recap)
 * repartent après une nouvelle analyse. sendMeetingRecapSlack court-circuite
 * si meeting_recap_slack_sent_at est déjà posé, idem le debrief avec
 * slack_sent_at ; les artefacts du recap précédent (ts, channel, permalink,
 * texte) pointent vers un message obsolète.
 */
export const SLACK_DELIVERY_RESET = {
  slack_sent_at: null,
  meeting_recap_slack_sent_at: null,
  meeting_recap_slack_text: null,
  meeting_recap_slack_ts: null,
  meeting_recap_slack_channel: null,
  meeting_recap_slack_permalink: null,
} as const;

/**
 * Déclenche l'analyse Sales Coach d'une ligne déjà passée en `pending`.
 *
 * Sur Netlify on appelle directement la Background Function (moins de sauts,
 * moins de risques de laisser la ligne bloquée en `pending`) ; en dev on tombe
 * sur la route Next.js, qui tourne inline. Le `transcriptUrl` est transmis
 * pour que l'analyseur n'ait pas à re-fetch Claap (le textUrl est valide 24h,
 * jamais stocké dans la ligne).
 *
 * Best-effort : une erreur est loggée, jamais levée. L'abort à 8s est attendu
 * sur la route inline (Claude met plus longtemps à démarrer) ; la Background
 * Function répond 202 en moins d'une seconde.
 */
export async function triggerSalesCoachAnalysis(opts: {
  origin: string;
  id: string;
  transcriptUrl: string;
  logTag: string;
}): Promise<{ ok: boolean; error?: string }> {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.warn(`[${opts.logTag}] INTERNAL_SECRET missing — analysis won't start`);
    return { ok: false, error: "INTERNAL_SECRET not configured" };
  }

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  const triggerUrl = isNetlifyEnv
    ? `${opts.origin}/.netlify/functions/sales-coach-analyze-background`
    : `${opts.origin}/api/sales-coach/analyze/${opts.id}`;
  const body = isNetlifyEnv
    ? JSON.stringify({ id: opts.id, transcriptUrl: opts.transcriptUrl })
    : JSON.stringify({ transcriptUrl: opts.transcriptUrl });

  try {
    const triggerRes = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!triggerRes.ok && triggerRes.status !== 202) {
      const text = await triggerRes.text().catch(() => "");
      console.error(`[${opts.logTag}] trigger non-2xx (${triggerRes.status}):`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[${opts.logTag}] trigger fetch failed:`, msg);
    }
  }
  return { ok: true };
}
