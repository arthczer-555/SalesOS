import type { Config } from "@netlify/functions";
import { logAgentRun } from "../../lib/intel/log-agent-run";

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
 *
 * Each agent run is appended to intel_agent_run_logs so /intel/agents → bouton
 * « Logs » montre l'historique complet (succès + échecs).
 */

// agentId = identifiant officiel défini dans lib/intel-agents.ts. Sert de clé
// d'attribution dans intel_agent_run_logs ET de filtre dans le drawer Logs.
const AGENTS: { path: string; agentId: string; label: string }[] = [
  // Posts + keywords (companies + coaching/L&D mentions). Le scan alimente
  // company-news / job-change / intent-content / hiring — on logge sous
  // company-news qui est l'agent piloté par cet endpoint.
  { path: "/api/linkedin/weekly-scan", agentId: "company-news", label: "weekly-scan" },
  // Pubs LinkedIn actives sur les boîtes monitored
  { path: "/api/intel/agents/ads/run", agentId: "ads-activity", label: "ads" },
  // Offres d'emploi ICP RH/L&D
  { path: "/api/intel/agents/hiring-spike/run", agentId: "hiring-spike", label: "hiring-spike" },
  // Likes des AM/AE concurrents
  { path: "/api/intel/agents/competitor-activity/run", agentId: "competitor-activity", label: "competitor-activity" },
  // Ajout automatique des champions HubSpot au Radar
  { path: "/api/intel/agents/champion-tracker/run", agentId: "champion-tracker", label: "champion-tracker" },
  // Levées / M&A / expansion via Tavily
  { path: "/api/intel/agents/funding/run", agentId: "funding-expansion", label: "funding" },
];

function extractSignalsCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.signalsCount === "number") return obj.signalsCount;
  const analysis = obj.analysis;
  if (
    analysis &&
    typeof analysis === "object" &&
    typeof (analysis as Record<string, unknown>).signals_created === "number"
  ) {
    return (analysis as { signals_created: number }).signals_created;
  }
  return 0;
}

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
    const startedAtIso = new Date().toISOString();
    const start = Date.now();
    let ok = false;
    let status = 0;
    let payload: unknown = null;
    let errorText: string | null = null;

    try {
      const res = await fetch(`${siteUrl}${agent.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      status = res.status;
      ok = res.ok;
      const text = await res.text();
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
      if (!ok) {
        errorText = `HTTP ${status} — ${text.slice(0, 1500)}`;
        console.error(`[intel-weekly-scan] ${agent.label} failed:`, status, payload);
      } else {
        console.log(`[intel-weekly-scan] ${agent.label} ok in ${Date.now() - start}ms`, payload);
      }
    } catch (e) {
      ok = false;
      errorText = e instanceof Error ? e.message : String(e);
      console.error(`[intel-weekly-scan] ${agent.label} fatal:`, e);
    }

    results.push({ agent: agent.label, ok, status, ms: Date.now() - start, payload });

    try {
      await logAgentRun({
        agentId: agent.agentId,
        triggeredBy: "cron",
        userId: null,
        startedAt: startedAtIso,
        status: ok ? "ok" : "error",
        signalsCount: extractSignalsCount(payload),
        error: errorText,
        payload,
      });
    } catch (logErr) {
      console.error(`[intel-weekly-scan] log insert failed for ${agent.label}:`, logErr);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`[intel-weekly-scan] DONE: ${okCount}/${AGENTS.length} agents ok in ${Date.now() - t0}ms`);
};

export const config: Config = {
  schedule: "0 6 * * 1", // every Monday 06:00 UTC = ~07h-08h Paris
};
