import { runRagInsightsRefresh } from "../../lib/rag-insights/run";

// Background function : collecte les tours de CoachelloAI, les fait juger par
// Claude, construit le rapport de gaps Notion et (option) envoie le recap Slack.
// Déclenchée soit par la route admin (x-internal-secret), soit par le cron hebdo
// rag-insights-scheduled (Bearer CRON_SECRET).
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const internalOk = !!internalSecret && req.headers.get("x-internal-secret") === internalSecret;
  const cronOk = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!internalOk && !cronOk) {
    console.error("[rag-insights-bg] unauthorized");
    return;
  }

  let body: { sinceDays?: number; sendSlack?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corps vide : on garde les défauts */
  }

  const result = await runRagInsightsRefresh({
    sinceDays: typeof body.sinceDays === "number" ? body.sinceDays : 30,
    sendSlack: body.sendSlack === true,
  });

  if (!result.ok) {
    console.error("[rag-insights-bg] failed:", result.error);
  } else {
    console.log(
      `[rag-insights-bg] done: ${result.analyzed} analyzed, ${result.gapsFound} gaps, slack=${result.slackSent}`,
    );
  }
};
