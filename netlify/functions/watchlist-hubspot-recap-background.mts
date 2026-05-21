import type { Context } from "@netlify/functions";
import { runHubspotRecap } from "../../lib/watchlist/fetch-company-recap";

// HTTP-triggered background function. Netlify renvoie 202 immédiatement à
// l'appelant et continue l'exécution en arrière-plan (jusqu'à 15 min). On en a
// besoin parce que le récap HubSpot enchaîne plusieurs dizaines d'appels
// (deals + engagements + contacts) et dépasserait le timeout sync ~26s.
//
// Auth : Bearer CRON_SECRET (posé par /api/watchlist/companies/[id]/briefs/hubspot-recap).
// Body : { scopeCompanyId: string, userId: string, briefId: string, startedAt: string }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { scopeCompanyId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  const scopeCompanyId = body.scopeCompanyId;
  if (!scopeCompanyId) {
    return new Response("missing scopeCompanyId", { status: 400 });
  }

  try {
    const res = await runHubspotRecap({ scopeCompanyId });
    if (!res.ok) {
      console.error("[watchlist-hubspot-recap-background] failed:", res.error);
    }
  } catch (e) {
    console.error("[watchlist-hubspot-recap-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
