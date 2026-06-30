import type { Context } from "@netlify/functions";
import { runAeAnalysis } from "../../lib/watchlist/run-ae-analysis";
import type { AeTarget } from "../../lib/watchlist/briefs";

// HTTP-triggered background function. Charge le contexte HubSpot (emails +
// contacts + deals) + news + secteur et appelle Claude Sonnet pour produire une
// analyse AE (reco de prospection). Peut prendre 30 à 90s (fetch emails inclus).
//
// Auth : Bearer CRON_SECRET (posé par /api/watchlist/companies/[id]/briefs/ae-analysis).
// Body : { scopeCompanyId: string, userId: string, briefId: string, startedAt: string, withMessages?: boolean, targets?: AeTarget[] }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { scopeCompanyId?: string; userId?: string; withMessages?: boolean; targets?: AeTarget[] } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  if (!body.scopeCompanyId || !body.userId) {
    return new Response("missing scopeCompanyId or userId", { status: 400 });
  }

  try {
    const res = await runAeAnalysis({
      scopeCompanyId: body.scopeCompanyId,
      userId: body.userId,
      withMessages: body.withMessages,
      targets: body.targets,
    });
    if (!res.ok) {
      console.error("[watchlist-ae-analysis-background] failed:", res.error);
    }
  } catch (e) {
    console.error("[watchlist-ae-analysis-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
