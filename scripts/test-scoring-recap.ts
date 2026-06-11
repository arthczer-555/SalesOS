/**
 * One-off : déclenche le vrai recap canal du scoring (buildAndSendScoringRecap)
 * avec les VRAIS scores depuis deal_scores.
 * Mode test (DEALS_AE_DIGEST_MODE=test) : DM à Arthur au lieu du canal.
 *
 * IMPORTANT — protection du cron du 1er/15 : la fonction stampe
 * deal_ae_digest_log ("__channel_recap__", run_date). Pour ne pas bloquer un
 * éventuel envoi prod le même jour, ce script supprime après coup le stamp
 * qu'il vient de créer (mais GARDE le seed slack_chat_threads pour pouvoir
 * tester la Q&A en thread).
 *
 * Usage : npx tsx scripts/test-scoring-recap.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import { buildAndSendScoringRecap } from "../lib/deals/scoring-recap";

const SENTINEL_OWNER = "__channel_recap__";

async function main() {
  const runDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC (même calcul que la fonction)
  console.log(`[test-scoring-recap] mode=${process.env.DEALS_AE_DIGEST_MODE || "test"} run_date=${runDate}`);

  // Stamp déjà présent aujourd'hui (vrai run) ? On ne le touchera pas.
  const { data: before } = await db
    .from("deal_ae_digest_log")
    .select("id")
    .eq("owner_id", SENTINEL_OWNER)
    .eq("run_date", runDate)
    .maybeSingle();
  if (before) {
    console.log(`[test-scoring-recap] ⚠️ recap déjà stampé aujourd'hui (id ${before.id}) : la fonction va skipper.`);
  }

  const result = await buildAndSendScoringRecap();
  console.log(`[test-scoring-recap] résultat:`, JSON.stringify(result));

  // Nettoyage : supprimer uniquement le stamp créé par ce test.
  if (!before && result.posted) {
    const { error } = await db
      .from("deal_ae_digest_log")
      .delete()
      .eq("owner_id", SENTINEL_OWNER)
      .eq("run_date", runDate);
    if (error) {
      console.error(`[test-scoring-recap] ⚠️ échec suppression du stamp, à purger manuellement :`, error.message);
    } else {
      console.log(`[test-scoring-recap] ✅ stamp du jour supprimé → un run prod aujourd'hui resterait possible.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
