import type { Context } from "@netlify/functions";
import { runOrgImport } from "../../lib/orgchart/run-import";

// Background Function : import d'un compte orgchart (CSV ou HubSpot) +
// classification Claude. Hors chemin sync (fetch HubSpot + LLM + insert N lignes
// dépassent le timeout sync). Auth Bearer CRON_SECRET. Body { jobId }.
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
    const res = await runOrgImport({ jobId });
    if (!res.ok) console.error("[orgchart-import-background] failed:", res.error);
  } catch (e) {
    console.error("[orgchart-import-background] unexpected:", e);
  }
  return new Response(null, { status: 200 });
};
