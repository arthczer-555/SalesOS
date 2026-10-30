import type { Config } from "@netlify/functions";

/**
 * Pot d'équipe 2026 (page /pot) : toutes les heures de 8h à 20h, heure de
 * Paris (07:00-19:00 UTC, CET jusqu'à la fin du jeu le 31/12).
 *
 * Relit l'onglet Factures, fige les paliers franchis et annonce dans
 * #office-life ; le lundi dès 11h, envoie aussi le récap hebdo ; le 31/12 à
 * 20h, le message de clôture. Après le 31/12 la route ne fait plus rien.
 * Quelques secondes de travail : pas de background function.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[team-pot-sync] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  const t0 = Date.now();
  try {
    const res = await fetch(`${siteUrl}/api/team-pot/sync`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[team-pot-sync] HTTP ${res.status}:`, text.slice(0, 500));
      return;
    }
    console.log(`[team-pot-sync] done in ${Date.now() - t0}ms: ${text.slice(0, 300)}`);
  } catch (e) {
    console.error("[team-pot-sync] fatal:", e instanceof Error ? e.message : e);
  }
};

export const config: Config = {
  schedule: "0 7-19 * * *", // toutes les heures, 8h-20h Paris (CET)
};
