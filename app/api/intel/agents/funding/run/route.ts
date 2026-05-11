import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchTavily } from "@/lib/tavily";
import { getTargetCompanies } from "@/lib/target-companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "Tavily non configuré" }, { status: 500 });
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

        // Dedup on URL
        const { data: existing } = await db
          .from("market_signals")
          .select("id")
          .eq("source_url", r.url)
          .eq("user_id", userIds[0] ?? user.id)
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

  return NextResponse.json({ ok: true, signalsCount, scanned: targets.length });
}
