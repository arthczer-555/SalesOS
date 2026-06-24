import type { Config } from "@netlify/functions";

/**
 * Cron hebdo (lundi 09:00 UTC) du rappel Slack des impressions à renseigner.
 *
 * Filet de sécurité indépendant : le scrape (06:00) déclenche déjà le digest en
 * fin de run, mais ce cron garantit l'envoi même si le scrape a échoué/traîné.
 * Le digest est idempotent (stamp notified_at) → pas de double DM.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[marketing-posts-digest-scheduled] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/marketing-posts-digest-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[marketing-posts-digest-scheduled] trigger HTTP ${res.status}`);
    } else {
      console.log("[marketing-posts-digest-scheduled] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[marketing-posts-digest-scheduled] trigger failed:", msg);
    }
  }
};

export const config: Config = {
  schedule: "0 9 * * 1", // tous les lundis à 09:00 UTC
};
