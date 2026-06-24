import type { Config } from "@netlify/functions";

/**
 * Cron hebdo (lundi 06:00 UTC) du scrape des posts LinkedIn propres.
 *
 * Déclencheur léger : POST vers la Background Function qui fait le gros du travail
 * (Bright Data datasets, plusieurs minutes). On découple pour ne pas tenir la
 * durée d'un scheduled function classique.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[marketing-posts-scrape-scheduled] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/marketing-posts-scrape-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[marketing-posts-scrape-scheduled] trigger HTTP ${res.status}`);
    } else {
      console.log("[marketing-posts-scrape-scheduled] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[marketing-posts-scrape-scheduled] trigger failed:", msg);
    }
  }
};

export const config: Config = {
  schedule: "0 6 * * 1", // tous les lundis à 06:00 UTC
};
