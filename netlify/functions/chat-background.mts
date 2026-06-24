import type { Context } from "@netlify/functions";
import { runChatJob } from "../../lib/chat/run-job";

// Background Function : agentic loop du chat web (CoachelloGPT). Sorti du chemin
// sync car la boucle HubSpot/Slack/Drive/Claap dépasse souvent les ~26s d'une
// fonction sync Netlify (background = jusqu'à 15 min). Écrit la progression dans
// chat_jobs, que le navigateur lit par polling.
//
// Auth : Bearer CRON_SECRET (posé par /api/chat).
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
    const res = await runChatJob({ jobId });
    if (!res.ok) console.error("[chat-background] failed:", res.error);
  } catch (e) {
    console.error("[chat-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};
