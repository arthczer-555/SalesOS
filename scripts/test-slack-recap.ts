/**
 * One-off : envoie le DM Slack de debrief coaching sur 1 analyse passée en
 * argument, ou auto-détecte les 2 plus récentes (1 prospect + 1 client).
 * Mode test (SLACK_MODE=test) : DM va à Arthur uniquement.
 *
 * Usage :
 *   npx tsx scripts/test-slack-recap.ts                 # auto: 1 prospect + 1 client récents
 *   npx tsx scripts/test-slack-recap.ts <analysisId>    # un id précis
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { sendSalesCoachSlack } from "../lib/sales-coach/slack";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const argId = process.argv[2];
  let ids: string[] = [];

  if (argId) {
    ids = [argId];
  } else {
    const { data: prospects } = await db
      .from("sales_coach_analyses")
      .select("id, audience, meeting_title, created_at")
      .eq("status", "done")
      .eq("audience", "prospect")
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: clients } = await db
      .from("sales_coach_analyses")
      .select("id, audience, meeting_title, created_at")
      .eq("status", "done")
      .eq("audience", "client")
      .order("created_at", { ascending: false })
      .limit(1);
    ids = [
      ...(prospects ?? []).map((r) => r.id),
      ...(clients ?? []).map((r) => r.id),
    ];
    for (const row of [...(prospects ?? []), ...(clients ?? [])]) {
      console.log(`[picked] ${row.audience} / ${row.id} / ${row.meeting_title} (${row.created_at})`);
    }
  }

  if (ids.length === 0) {
    console.error("No analysis to test.");
    process.exit(1);
  }

  for (const id of ids) {
    console.log(`\n=== ${id} ===`);
    const { data: row } = await db
      .from("sales_coach_analyses")
      .select("audience, meeting_title, score_global, analysis")
      .eq("id", id)
      .single();
    if (!row) {
      console.log("not found");
      continue;
    }
    const a = row.analysis as {
      summary?: string;
      strengths?: string[];
      weaknesses?: string[];
      coaching_priorities?: string[];
    } | null;
    console.log(`audience: ${row.audience} / meeting: ${row.meeting_title} / score: ${row.score_global}`);
    console.log(`summary: ${a?.summary ?? "(none)"}`);
    console.log(`strengths: ${JSON.stringify(a?.strengths ?? [], null, 2)}`);
    console.log(`weaknesses: ${JSON.stringify(a?.weaknesses ?? [], null, 2)}`);
    console.log(`coaching_priorities: ${JSON.stringify(a?.coaching_priorities ?? [], null, 2)}`);

    const hasEmDash =
      [a?.summary ?? "", ...(a?.strengths ?? []), ...(a?.weaknesses ?? []), ...(a?.coaching_priorities ?? [])]
        .some((s) => typeof s === "string" && s.includes("—"));
    console.log(`em dashes in synthese fields: ${hasEmDash ? "YES (bad)" : "no"}`);

    console.log(`\n>>> sending Slack DM (mode test → Arthur)`);
    const res = await sendSalesCoachSlack(db, id);
    console.log(JSON.stringify(res));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
