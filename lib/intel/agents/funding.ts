// ── Core de l'agent Funding & Expansion ──────────────────────────────────
// Extrait de /api/intel/agents/funding/run pour être exécuté en Netlify
// Background Function (15 min de budget vs ~26s sync) sans repasser par un
// fetch HTTP qui se ferait couper par l'« Inactivity Timeout » du proxy.

import { db } from "@/lib/db";
import { searchTavily } from "@/lib/tavily";
import { getTargetCompanies } from "@/lib/target-companies";

export interface RunFundingAgentOptions {
  callerUserId: string | null; // null = cron / background
}

export interface RunFundingAgentResult {
  signalsCount: number;
  scanned: number;
}

export async function runFundingAgent(
  opts: RunFundingAgentOptions
): Promise<RunFundingAgentResult> {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("Tavily non configuré");
  }

  const targets = (await getTargetCompanies()).slice(0, 30);
  const { data: allUsers } = await db.from("users").select("id");
  const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

  let signalsCount = 0;
  for (const company of targets) {
    const queries = [
      `"${company}" levée OR funding OR Series`,
      `"${company}" acquisition OR rachat OR M&A`,
      `"${company}" expansion OR ouverture bureau`,
    ];
    for (const q of queries) {
      const results = await searchTavily(q, { days: 60, maxResults: 3 });
      for (const r of results) {
        const text = (r.content ?? "").toLowerCase();
        const isFunding = /\b(rais(e|ed|ing)|levée|series\s+[a-d]|funding|funded)\b/i.test(text);
        const isMA = /\b(acquired|acquisition|m&a|merger|rachat)\b/i.test(text);
        const isExpansion = /\b(open(ed|ing)|expan(d|sion)|launch(es|ed)|ouvre|ouvert)\b/i.test(text);

        if (!isFunding && !isMA && !isExpansion) continue;

        const dedupUserId = userIds[0] ?? opts.callerUserId;
        if (!dedupUserId) continue;

        const { data: existing } = await db
          .from("market_signals")
          .select("id")
          .eq("source_url", r.url)
          .eq("user_id", dedupUserId)
          .maybeSingle();
        if (existing) continue;

        const signalType = isFunding ? "funding" : isMA ? "expansion" : "expansion";
        const title = `${company} : ${r.title.slice(0, 100)}`;
        const score = isFunding ? 80 : isMA ? 75 : 65;

        if (userIds.length > 0) {
          await db.from("market_signals").insert(
            userIds.map((uid) => ({
              user_id: uid,
              agent_id: "funding-expansion",
              company_name: company,
              signal_type: signalType,
              title,
              summary: r.content.slice(0, 400),
              strength: score >= 75 ? 3 : 2,
              score,
              source_url: r.url,
              source_domain: new URL(r.url).hostname,
              why_relevant: isFunding
                ? `Levée détectée → budget RH/L&D potentiellement débloqué.`
                : isMA
                  ? `Opération M&A → besoin d'accompagnement managérial des équipes.`
                  : `Expansion détectée → recrutement managers à l'horizon.`,
              suggested_action: `Approche tactique : féliciter + proposer un accompagnement.`,
              action_type: "linkedin",
              is_read: false,
              is_actioned: false,
            }))
          );
          signalsCount++;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { signalsCount, scanned: targets.length };
}
