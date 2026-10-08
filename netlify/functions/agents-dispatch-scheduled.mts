import type { Config } from "@netlify/functions";
import { dispatchDueAgents } from "../../lib/agents/dispatch";

/**
 * Dispatcher des agents (/agents), toutes les 10 min.
 *
 * Travail léger (quelques requêtes DB + un POST par agent échu) : chaque run
 * part dans sa propre Background Function agents-run-background, avec son
 * propre budget de 15 min.
 */
export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  if (!siteUrl) {
    console.error("[agents-dispatch] missing URL/SITE_URL");
    return;
  }
  try {
    const { dispatched, reaped } = await dispatchDueAgents(siteUrl);
    if (dispatched || reaped) console.log(`[agents-dispatch] dispatched=${dispatched} reaped=${reaped}`);
  } catch (e) {
    console.error("[agents-dispatch] failed:", e instanceof Error ? e.message : e);
  }
};

export const config: Config = {
  schedule: "*/10 * * * *",
};
