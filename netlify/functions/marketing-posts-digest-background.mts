import type { Context } from "@netlify/functions";
import { buildAndSendPostsDigest } from "../../lib/marketing/posts-digest";

// Background function : rappel Slack des impressions à renseigner (posts +7j sans
// impressions). Léger (requête + 1 DM) mais gardé en background pour partager
// l'auth/le chaînage avec le scrape.
//
// Auth : Bearer CRON_SECRET (cron planifié ou chaînage depuis le scrape).
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const res = await buildAndSendPostsDigest();
    console.log("[marketing-posts-digest-background] done:", JSON.stringify(res));
  } catch (e) {
    console.error("[marketing-posts-digest-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
