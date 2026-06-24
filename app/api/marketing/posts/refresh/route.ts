import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runWeeklyPostScrape } from "@/lib/marketing/linkedin-posts";

export const dynamic = "force-dynamic";

const BG_FN = "marketing-posts-scrape-background";

export interface RefreshPostsResponse {
  ok: boolean;
  queued?: boolean;
  error?: string;
}

// Refresh manuel : scrape la dernière année + met à jour les marqueurs du graphe
// (comme le cron hebdo), mais sans déclencher le digest Slack (triggerDigest:false,
// réservé au cron). Mêmes options par défaut que le cron (syncEvents + sinceDays=365).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NETLIFY === "true") {
    // En prod, le scrape DOIT passer par la Background Function : `after()` tourne
    // dans la fonction sync (limite plan ~26 s) et serait tué en plein scrape.
    if (!cronSecret) {
      return NextResponse.json(
        { ok: false, error: "Refresh unavailable: CRON_SECRET is not configured." },
        { status: 503 },
      );
    }
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ triggerDigest: false }),
    }).catch((e) => console.error("[marketing/posts/refresh] background invoke failed:", e));
    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  }

  // Dev local uniquement : exécution in-process après la réponse.
  after(async () => {
    const res = await runWeeklyPostScrape();
    if (!res.ok) console.error("[marketing/posts/refresh] dev run failed:", JSON.stringify(res));
  });
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}
