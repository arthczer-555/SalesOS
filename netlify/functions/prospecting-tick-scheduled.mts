import type { Config } from "@netlify/functions";

/**
 * Cron du moteur Prospecting (toutes les 10 min).
 *
 * Déclencheur léger : POST vers la Background Function qui fait le travail
 * (synchro des réponses, envoi des étapes dues, tâches manuelles). Une
 * scheduled function classique serait coupée bien avant les ~11 min de budget.
 * Le moteur n'envoie rien tant que PROSPECTING_SEND_MODE vaut "off" (défaut).
 */
const handler = async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[prospecting-tick-scheduled] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/prospecting-tick-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[prospecting-tick-scheduled] trigger HTTP ${res.status}`);
    } else {
      console.log("[prospecting-tick-scheduled] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[prospecting-tick-scheduled] trigger failed:", msg);
    }
  }
};

export default handler;

export const config: Config = {
  schedule: "*/10 * * * *", // toutes les 10 minutes
};
