// ── Core de l'agent Ads Activity ─────────────────────────────────────────
// Extrait de /api/intel/agents/ads/run pour exécution en Netlify Background
// Function (budget 15 min vs ~26s sync).

import { db } from "@/lib/db";
import { getCompanyAds, listRadarCompanies } from "@/lib/netrows";

interface AdItem {
  adUrl: string;
  text: string;
  postedAt: string;
}

export interface RunAdsAgentResult {
  signalsCount: number;
  creditsUsed: number;
  scanned: number;
  errors: string[];
}

export async function runAdsAgent(): Promise<RunAdsAgentResult> {
  if (!process.env.NETROWS_API_KEY) {
    throw new Error("Netrows non configuré");
  }

  const radar = await listRadarCompanies();
  const companies = (radar.data ?? []).slice(0, 30);
  const { data: allUsers } = await db.from("users").select("id");
  const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

  let signalsCount = 0;
  let creditsUsed = 0;
  const errors: string[] = [];

  for (const c of companies) {
    try {
      const r = await getCompanyAds(c.username);
      creditsUsed++;
      const ads = ((r.data ?? []) as AdItem[]).slice(0, 5);
      if (ads.length === 0) continue;

      const title = `${c.username} : ${ads.length} pub${ads.length > 1 ? "s" : ""} LinkedIn active${ads.length > 1 ? "s" : ""}`;
      const summary = ads.map((a) => `- ${a.text.slice(0, 120)}`).join("\n").slice(0, 600);

      const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: recent } = await db
        .from("market_signals")
        .select("id")
        .eq("agent_id", "ads-activity")
        .eq("company_name", c.username)
        .gte("created_at", oneWeekAgo)
        .limit(1);
      if (recent && recent.length > 0) continue;

      if (userIds.length > 0) {
        await db.from("market_signals").insert(
          userIds.map((uid) => ({
            user_id: uid,
            agent_id: "ads-activity",
            company_name: c.username,
            signal_type: "ads",
            title,
            summary,
            strength: 2,
            score: 60,
            source_url: ads[0].adUrl,
            source_domain: "linkedin.com",
            why_relevant: "Pubs LinkedIn actives = budget marketing ouvert et besoin de notoriété, souvent corrélé à un cycle de croissance.",
            suggested_action: "Adapter l'angle d'approche en partant des messages publicitaires diffusés.",
            action_type: "linkedin",
            is_read: false,
            is_actioned: false,
          }))
        );
        signalsCount++;
      }

      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      errors.push(`${c.username}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { signalsCount, creditsUsed, scanned: companies.length, errors };
}
