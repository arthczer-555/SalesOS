import type { Config } from "@netlify/functions";

/**
 * Cron : runs every Monday at 06:00 UTC (~07:00 Paris winter / 08:00 summer).
 *
 * Fires all the intel agents in sequence so sales sees fresh signals at the
 * start of the week. Each agent self-authenticates via Bearer CRON_SECRET
 * (handled by `lib/cron-auth.ts`). The corresponding routes are whitelisted
 * in `middleware.ts`.
 *
 * Background functions on Netlify can run up to 15 min, which is plenty
 * since each agent maxes out around 1-2 min.
 */

const AGENTS: { path: string; label: string }[] = [
  // Posts + keywords (companies + coaching/L&D mentions)
  { path: "/api/linkedin/weekly-scan", label: "weekly-scan" },
  // Pubs LinkedIn actives sur les boîtes monitored
  { path: "/api/intel/agents/ads/run", label: "ads" },
  // Offres d'emploi ICP RH/L&D
  { path: "/api/intel/agents/hiring-spike/run", label: "hiring-spike" },
  // Likes des AM/AE concurrents
  { path: "/api/intel/agents/competitor-activity/run", label: "competitor-activity" },
  // Ajout automatique des champions HubSpot au Radar
  { path: "/api/intel/agents/champion-tracker/run", label: "champion-tracker" },
  // Levées / M&A / expansion via Tavily
  { path: "/api/intel/agents/funding/run", label: "funding" },
];

export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[intel-weekly-scan] missing URL/SITE_URL or CRON_SECRET");
    return;
  }

  const t0 = Date.now();
  const results: { agent: string; ok: boolean; status: number; ms: number; payload?: unknown }[] = [];

  for (const agent of AGENTS) {
    const start = Date.now();
    try {
      const res = await fetch(`${siteUrl}${agent.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => null);
      results.push({ agent: agent.label, ok: res.ok, status: res.status, ms: Date.now() - start, payload });
      if (!res.ok) {
        console.error(`[intel-weekly-scan] ${agent.label} failed:`, res.status, payload);
      } else {
        console.log(`[intel-weekly-scan] ${agent.label} ok in ${Date.now() - start}ms`, payload);
      }
    } catch (e) {
      results.push({ agent: agent.label, ok: false, status: 0, ms: Date.now() - start });
      console.error(`[intel-weekly-scan] ${agent.label} fatal:`, e);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`[intel-weekly-scan] DONE: ${okCount}/${AGENTS.length} agents ok in ${Date.now() - t0}ms`);
};

export const config: Config = {
  schedule: "0 6 * * 1", // every Monday 06:00 UTC = ~07h-08h Paris
};
