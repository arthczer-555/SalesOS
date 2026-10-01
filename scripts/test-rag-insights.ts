/**
 * One-off : lance le vrai run RAG Insights (collecte des tours de CoachelloAI,
 * jugement Claude, rapport de gaps Notion) et, en option, envoie le recap Slack.
 *
 * Mode test (RAG_INSIGHTS_SLACK_MODE non défini) : DM à Arthur uniquement.
 *
 * Usage :
 *   npx tsx scripts/test-rag-insights.ts              # analyse 30j, pas de Slack
 *   npx tsx scripts/test-rag-insights.ts --slack      # + envoi du recap
 *   npx tsx scripts/test-rag-insights.ts --days 7 --slack
 *   npx tsx scripts/test-rag-insights.ts --slack-only # recap seul, sans réanalyse
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runRagInsightsRefresh } from "../lib/rag-insights/run";
import { sendRagRecap } from "../lib/rag-insights/slack-recap";

async function main() {
  const args = process.argv.slice(2);
  const withSlack = args.includes("--slack");
  const slackOnly = args.includes("--slack-only");
  const daysIndex = args.indexOf("--days");
  const sinceDays = daysIndex >= 0 ? Number(args[daysIndex + 1]) || 30 : 30;

  const mode = process.env.RAG_INSIGHTS_SLACK_MODE === "prod" ? "prod" : "test";
  console.log(`[test-rag-insights] mode=${mode} days=${sinceDays} slack=${withSlack || slackOnly}`);

  if (slackOnly) {
    const recap = await sendRagRecap({ force: true });
    console.log("[test-rag-insights] recap:", JSON.stringify(recap));
    return;
  }

  const result = await runRagInsightsRefresh({ sinceDays, sendSlack: withSlack });
  console.log("[test-rag-insights] résultat:", JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
