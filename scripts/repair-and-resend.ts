/**
 * Applique la nouvelle `repairAnalysis` sur les analyses passées en argument
 * (ou auto: 1 prospect + 1 client les plus récents), met à jour la row si le
 * repair a effectivement récupéré du contenu, puis renvoie le DM Slack (mode
 * test, donc à Arthur uniquement).
 *
 * Usage :
 *   npx tsx scripts/repair-and-resend.ts
 *   npx tsx scripts/repair-and-resend.ts <analysisId> [<analysisId> ...]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  computeGlobalScore,
  repairAnalysis,
  type AnySalesCoachAnalysis,
} from "../lib/guides/sales-coach";
import { sendSalesCoachSlack } from "../lib/sales-coach/slack";

function diffArrays(before: unknown, after: unknown): string {
  const b = Array.isArray(before) ? before.length : "n/a";
  const a = Array.isArray(after) ? after.length : "n/a";
  return `${b} -> ${a}`;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let ids: string[] = process.argv.slice(2);
  if (ids.length === 0) {
    const { data: p } = await db
      .from("sales_coach_analyses")
      .select("id")
      .eq("status", "done")
      .eq("audience", "prospect")
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: c } = await db
      .from("sales_coach_analyses")
      .select("id")
      .eq("status", "done")
      .eq("audience", "client")
      .order("created_at", { ascending: false })
      .limit(1);
    ids = [...(p ?? []).map((r) => r.id), ...(c ?? []).map((r) => r.id)];
  }

  for (const id of ids) {
    console.log(`\n=== ${id} ===`);
    const { data: row, error } = await db
      .from("sales_coach_analyses")
      .select("audience, meeting_title, score_global, analysis")
      .eq("id", id)
      .single();
    if (error || !row) {
      console.error("fetch failed:", error?.message ?? "not found");
      continue;
    }

    const before = row.analysis as Partial<AnySalesCoachAnalysis> | null;
    if (!before) {
      console.log("no analysis blob, skipping");
      continue;
    }

    const after = repairAnalysis(before);

    const fields = ["coaching_priorities", "strengths", "weaknesses", "risks", "key_moments"] as const;
    const changes: string[] = [];
    for (const f of fields) {
      const b = (before as Record<string, unknown>)[f];
      const a = (after as Record<string, unknown>)[f];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        changes.push(`${f}: ${diffArrays(b, a)}`);
      }
    }

    if (changes.length === 0) {
      console.log("no change after repair, skipping DB update");
    } else {
      console.log("repair recovered fields:");
      for (const c of changes) console.log(`  - ${c}`);
      const newScore = computeGlobalScore(after);
      const { error: upErr } = await db
        .from("sales_coach_analyses")
        .update({ analysis: after, score_global: newScore })
        .eq("id", id);
      if (upErr) {
        console.error("DB update failed:", upErr.message);
        continue;
      }
      console.log(`DB updated. new score_global=${newScore}`);
    }

    console.log(`>>> sending Slack DM (mode test)`);
    const res = await sendSalesCoachSlack(db, id);
    console.log(JSON.stringify(res));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
