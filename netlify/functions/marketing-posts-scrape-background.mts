import type { Context } from "@netlify/functions";
import { runWeeklyPostScrape, type ScrapeOptions } from "../../lib/marketing/linkedin-posts";

// Background function : scrape complet des posts LinkedIn propres via Bright Data
// (datasets, plusieurs minutes ; runtime Background Function ~15 min).
//
// Auth : Bearer CRON_SECRET (posé par le cron planifié ou /api/marketing/posts/refresh).
// Body (optionnel) : ScrapeOptions { syncEvents?, sinceDays?, timeoutMs? } + triggerDigest?.
//  - cron hebdo : {} → marqueurs graphe + digest chaîné.
//  - init annuelle : { syncEvents:false, sinceDays:365, triggerDigest:false } → page seule.
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let triggerDigest = true;
  let scrapeOpts: ScrapeOptions = {};
  try {
    const body = (await req.json()) as ScrapeOptions & { triggerDigest?: boolean };
    const { triggerDigest: td, ...rest } = body ?? {};
    if (td === false) triggerDigest = false;
    scrapeOpts = rest;
  } catch {
    /* pas de body → comportement cron hebdo par défaut */
  }

  try {
    const res = await runWeeklyPostScrape(scrapeOpts);
    console.log("[marketing-posts-scrape-background] done:", JSON.stringify(res));

    // Chaînage : rappel des impressions sur les posts fraîchement scrapés (cron hebdo).
    // Désactivé pour l'init (éviterait un DM listant une année entière de posts).
    const siteUrl = process.env.URL || process.env.SITE_URL;
    if (triggerDigest && siteUrl) {
      fetch(`${siteUrl}/.netlify/functions/marketing-posts-digest-background`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      }).catch((e) => console.error("[marketing-posts-scrape-background] digest trigger failed:", e));
    }
  } catch (e) {
    console.error("[marketing-posts-scrape-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
