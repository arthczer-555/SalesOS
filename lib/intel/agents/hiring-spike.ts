// ── Core de l'agent Hiring Spike ─────────────────────────────────────────
// Extrait de /api/intel/agents/hiring-spike/run pour exécution en Netlify
// Background Function (budget 15 min vs ~26s sync).

import { db } from "@/lib/db";
import { getCompanyJobs, listRadarCompanies } from "@/lib/netrows";

interface Job {
  title: string;
  location: string;
  postedAt: string;
  url: string;
}

const ICP_KEYWORDS = [
  "drh",
  "directeur des ressources humaines",
  "head of people",
  "head of l&d",
  "head of learning",
  "talent",
  "people",
  "rh",
  "hr",
  "training",
  "formation",
  "coach",
];

function isIcpRole(title: string): boolean {
  const t = title.toLowerCase();
  return ICP_KEYWORDS.some((k) => t.includes(k));
}

export interface RunHiringSpikeResult {
  signalsCount: number;
  creditsUsed: number;
  scanned: number;
}

export async function runHiringSpikeAgent(): Promise<RunHiringSpikeResult> {
  if (!process.env.NETROWS_API_KEY) {
    throw new Error("Netrows non configuré");
  }

  const radar = await listRadarCompanies();
  const companies = (radar.data ?? []).slice(0, 30);
  const { data: allUsers } = await db.from("users").select("id");
  const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

  let signalsCount = 0;
  let creditsUsed = 0;

  for (const c of companies) {
    try {
      const r = await getCompanyJobs(c.username);
      creditsUsed++;
      const jobs = ((r.data ?? []) as Job[]).filter((j) => isIcpRole(j.title)).slice(0, 5);
      if (jobs.length === 0) continue;

      const title = `${c.username} : ${jobs.length} offre${jobs.length > 1 ? "s" : ""} ICP RH/L&D ouverte${jobs.length > 1 ? "s" : ""}`;
      const summary = jobs.map((j) => `- ${j.title} (${j.location ?? "-"})`).join("\n");

      const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: recent } = await db
        .from("market_signals")
        .select("id")
        .eq("agent_id", "hiring-spike")
        .eq("company_name", c.username)
        .gte("created_at", oneWeekAgo)
        .limit(1);
      if (recent && recent.length > 0) continue;

      if (userIds.length > 0) {
        await db.from("market_signals").insert(
          userIds.map((uid) => ({
            user_id: uid,
            agent_id: "hiring-spike",
            company_name: c.username,
            signal_type: "hiring",
            title,
            summary,
            strength: 3,
            score: 75,
            source_url: jobs[0].url,
            source_domain: "linkedin.com",
            why_relevant: `${jobs.length} poste${jobs.length > 1 ? "s" : ""} RH/L&D en recherche, la structure se renforce, signal d'investissement humain.`,
            suggested_action: `Contacter le DRH actuel pour proposer un coaching d'onboarding des nouveaux managers.`,
            action_type: "email",
            is_read: false,
            is_actioned: false,
          }))
        );
        signalsCount++;
      }

      await new Promise((r) => setTimeout(r, 1200));
    } catch {
      /* continue */
    }
  }

  return { signalsCount, creditsUsed, scanned: companies.length };
}
