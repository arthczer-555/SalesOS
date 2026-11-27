import type { Config } from "@netlify/functions";
import { runMaintenance } from "../../lib/meetings/maintenance";

/**
 * Flux #1y-new-meetings, toutes les 15 min : relance des annonces bloquées,
 * rappel à l'auteur après 24 h sans réponse, expiration. Travail léger : le
 * traitement lui-même part dans meeting-announcement-background.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const secret = process.env.INTERNAL_SECRET;
  if (!siteUrl || !secret) {
    console.error("[meeting-announcements] missing URL or INTERNAL_SECRET");
    return;
  }
  const dispatch = async (id: string) => {
    await fetch(`${siteUrl}/.netlify/functions/meeting-announcement-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
  };
  try {
    const res = await runMaintenance(dispatch);
    if (res.redispatched || res.reminded || res.expired || res.gaveUp) console.log("[meeting-announcements]", JSON.stringify(res));
  } catch (e) {
    console.error("[meeting-announcements] failed:", e instanceof Error ? e.message : e);
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
