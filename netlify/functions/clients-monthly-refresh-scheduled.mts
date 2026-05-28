import type { Config } from "@netlify/functions";

/**
 * Cron mensuel des clients (1er du mois, 03:00 UTC).
 *
 * Déclencheur léger : il POST vers la Background Function qui fait le gros du
 * travail (sync facturation + refresh incrémental de tous les clients 'done').
 * On découple pour ne pas tenir la durée d'un scheduled function classique :
 * chaque refresh enchaîne plusieurs appels Claude, c'est un job long qui doit
 * tourner dans une Background Function (runtime ~15 min).
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!siteUrl || !internalSecret) {
    console.error("[clients-monthly-refresh] missing URL/SITE_URL or INTERNAL_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/clients-monthly-refresh-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[clients-monthly-refresh] trigger HTTP ${res.status}`);
    } else {
      console.log("[clients-monthly-refresh] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[clients-monthly-refresh] trigger failed:", msg);
    }
  }
};

export const config: Config = {
  schedule: "0 3 1 * *", // 1er de chaque mois, 03:00 UTC
};
