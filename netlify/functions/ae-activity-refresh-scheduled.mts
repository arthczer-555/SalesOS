import type { Config } from "@netlify/functions";

/**
 * Cron quotidien (06:00 UTC, avant la journée de travail) du refresh du
 * dashboard AE Sales Activity.
 *
 * Quotidien et pas hebdo à cause de la vue manager : /admin/ae-activity lit la
 * base sans jamais déclencher de recalcul, contrairement au dashboard d'un rep
 * (/api/me/dashboard/refresh, garde de 3h). Un cron hebdo y donnait donc des
 * chiffres vieux de plusieurs jours pour tout rep qui ne s'était pas connecté.
 *
 * La reco de coaching, elle, reste HEBDO : elle est plafonnée à une génération
 * par rep et par semaine dans buildCoaching (RECO_MAX_AGE_MS), donc ce passage
 * quotidien recalcule la data sans repayer un appel Claude par rep et par jour.
 *
 * Déclencheur léger : POST vers la Background Function qui fait le gros du
 * travail (fetch HubSpot + Sheet + Claap + Slack + coaching, plusieurs minutes).
 * On découple pour ne pas tenir la durée d'un scheduled function classique.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[ae-activity-refresh-scheduled] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/ae-activity-refresh-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "cron" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`[ae-activity-refresh-scheduled] trigger HTTP ${res.status}`);
    } else {
      console.log("[ae-activity-refresh-scheduled] background triggered");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[ae-activity-refresh-scheduled] trigger failed:", msg);
    }
  }
};

export const config: Config = {
  schedule: "0 6 * * *", // tous les jours à 06:00 UTC
};
