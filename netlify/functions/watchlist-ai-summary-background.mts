import type { Context } from "@netlify/functions";
import { runAiSummary } from "../../lib/watchlist/run-ai-summary";

// HTTP-triggered background function. Compose le contexte (HubSpot recap +
// news + radar + signaux) et appelle Claude haiku 4.5 pour produire un brief
// sales actionnable. Peut prendre 20 à 60s.
//
// Auth : Bearer CRON_SECRET (posé par /api/watchlist/companies/[id]/briefs/ai-summary).
// Body : { scopeCompanyId: string, userId: string, briefId: string, startedAt: string }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { scopeCompanyId?: string; userId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  if (!body.scopeCompanyId || !body.userId) {
    return new Response("missing scopeCompanyId or userId", { status: 400 });
  }

  try {
    const res = await runAiSummary({ scopeCompanyId: body.scopeCompanyId, userId: body.userId });
    if (!res.ok) {
      console.error("[watchlist-ai-summary-background] failed:", res.error);
    }
  } catch (e) {
    console.error("[watchlist-ai-summary-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
