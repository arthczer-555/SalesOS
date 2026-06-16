import type { Context } from "@netlify/functions";
import { runAccountRefresh } from "../../lib/orgchart/run-account-refresh";

// Background Function : "Sync from HubSpot" (re-fetch + validation Apollo des
// postes + update HubSpot + ré-analyse hiérarchie). Auth Bearer CRON_SECRET.
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
    const res = await runAccountRefresh({ jobId });
    if (!res.ok) console.error("[orgchart-refresh-background] failed:", res.error);
  } catch (e) {
    console.error("[orgchart-refresh-background] unexpected:", e);
  }
  return new Response(null, { status: 200 });
};
