import type { Config } from "@netlify/functions";

/**
 * Cron hebdo des clients (lundi, 04:00 UTC) : l'équipe démarre la semaine avec
 * des fiches à jour (Claap, HubSpot, Slack, news, Next actions).
 *
 * Déclencheur léger : il POST vers la Background Function qui fait la synchro
 * billing puis lance un refresh par client. Un scheduled function classique ne
 * tiendrait pas la durée.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!siteUrl || !internalSecret) {
    console.error("[clients-weekly-refresh] missing URL/SITE_URL or INTERNAL_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/clients-weekly-refresh-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[clients-weekly-refresh] trigger HTTP ${res.status}`);
    } else {
      console.log("[clients-weekly-refresh] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[clients-weekly-refresh] trigger failed:", msg);
    }
  }
};

export const config: Config = {
  schedule: "0 4 * * 1", // chaque lundi, 04:00 UTC
};
