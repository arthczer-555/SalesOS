import type { Context } from "@netlify/functions";
import { runApolloBulkSearch } from "../../lib/apollo/run-bulk-search";

// Background Function : découverte bulk Apollo sur la watchlist. Pour chaque
// company liée à HubSpot, recherche les nouveaux profils ICP (search seul, pas
// de crédit). Sorti du chemin sync (1 search + lookups HubSpot par company).
//
// Auth : Bearer CRON_SECRET (posé par /api/apollo/bulk).
// Body : { jobId: string }
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let jobId: string | undefined;
  try {
    const body = (await req.json()) as { jobId?: string };
    jobId = body.jobId;
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  if (!jobId) return new Response("missing jobId", { status: 400 });

  try {
    const res = await runApolloBulkSearch({ jobId });
    if (!res.ok) console.error("[apollo-bulk-search-background] failed:", res.error);
  } catch (e) {
    console.error("[apollo-bulk-search-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
