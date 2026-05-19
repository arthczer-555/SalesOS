import type { Config } from "@netlify/functions";

/**
 * Cron : runs every Monday at 06:00 UTC (~07:00 Paris winter / 08:00 summer).
 *
 * Au lieu de fetcher les routes sync /api/intel/agents/*\/run (qui timeoutent
 * à ~26s sur Netlify Pro), on dispatch en fire-and-forget vers une Background
 * Function dédiée par agent. Chaque BG fn logge elle-même son outcome dans
 * intel_agent_run_logs + intel_agent_runs, donc rien à tracker côté scan.
 *
 * Les dispatchs sont espacés de quelques secondes pour éviter de saturer les
 * fournisseurs (Netrows, HubSpot, Tavily) au même instant.
 */

interface AgentDispatch {
  bgFn: string;
  label: string;
}

const DISPATCH: AgentDispatch[] = [
  { bgFn: "intel-company-news-background", label: "company-news" },
  { bgFn: "intel-ads-background", label: "ads" },
  { bgFn: "intel-hiring-spike-background", label: "hiring-spike" },
  { bgFn: "intel-competitor-activity-background", label: "competitor-activity" },
  { bgFn: "intel-champion-tracker-background", label: "champion-tracker" },
  { bgFn: "intel-funding-background", label: "funding" },
];

const STAGGER_MS = 3_000;

export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[intel-weekly-scan] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  let dispatched = 0;
  const errors: { label: string; error: string }[] = [];

  for (const agent of DISPATCH) {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/${agent.bgFn}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: null, startedAt, triggeredBy: "cron" }),
      });
      // 202 attendu (BG fn renvoie immédiatement). Tout autre code = mauvaise
      // config (auth, fn pas déployée).
      if (res.status !== 202 && res.status !== 200) {
        const text = await res.text().catch(() => "");
        errors.push({ label: agent.label, error: `HTTP ${res.status} ${text.slice(0, 200)}` });
        console.error(`[intel-weekly-scan] dispatch ${agent.label} returned ${res.status}:`, text.slice(0, 300));
      } else {
        dispatched++;
        console.log(`[intel-weekly-scan] dispatched ${agent.label} → ${agent.bgFn}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ label: agent.label, error: msg });
      console.error(`[intel-weekly-scan] dispatch ${agent.label} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, STAGGER_MS));
  }

  console.log(
    `[intel-weekly-scan] DONE: ${dispatched}/${DISPATCH.length} dispatched in ${Date.now() - t0}ms`,
    errors.length > 0 ? { errors } : "",
  );
};

export const config: Config = {
  schedule: "0 6 * * 1", // every Monday 06:00 UTC
};
