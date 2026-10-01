/**
 * One-off : déclenche le vrai digest "deal review" par AE via le BOT CoachelloAI
 * (buildAndSendAeDigests), avec les VRAIS scores depuis deal_scores.
 * Mode test (DEALS_AE_DIGEST_MODE=test) : tous les DM partent chez Arthur.
 *
 * IMPORTANT — protection du cron du 1er/15 : la fonction stampe
 * deal_ae_digest_log (owner_id, run_date) et ne re-DM jamais un owner déjà
 * loggé le même jour. Pour ne PAS bloquer l'envoi prod de ce soir, ce script
 * supprime, après coup, les lignes du jour qu'il vient lui-même de créer.
 *
 * Usage : npx tsx scripts/test-ae-digest.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import { buildAndSendAeDigests } from "../lib/deals/ae-digest";

async function main() {
  const runDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC (même calcul que la fonction)
  console.log(`[test-ae-digest] mode=${process.env.DEALS_AE_DIGEST_MODE || "test"} run_date=${runDate}`);

  // Snapshot des lignes déjà présentes aujourd'hui (ne pas y toucher).
  const { data: before } = await db
    .from("deal_ae_digest_log")
    .select("id")
    .eq("run_date", runDate);
  const preexisting = new Set((before ?? []).map((r: { id: number | string }) => r.id));
  console.log(`[test-ae-digest] lignes pré-existantes pour ${runDate} : ${preexisting.size}`);

  // Vrai chemin de l'app : envoi par le bot CoachelloAI.
  const result = await buildAndSendAeDigests();
  console.log(`[test-ae-digest] résultat:`, JSON.stringify(result));

  // Nettoyage : supprimer uniquement les stamps créés par ce test.
  const { data: after } = await db
    .from("deal_ae_digest_log")
    .select("id")
    .eq("run_date", runDate);
  const created = (after ?? [])
    .map((r: { id: number | string }) => r.id)
    .filter((id) => !preexisting.has(id));

  if (created.length) {
    const { error } = await db.from("deal_ae_digest_log").delete().in("id", created);
    if (error) {
      console.error(`[test-ae-digest] ⚠️ échec suppression des stamps (${created.length}) :`, error.message);
      console.error(`[test-ae-digest] ⚠️ À PURGER MANUELLEMENT pour ne pas bloquer le cron de ce soir : ids`, created);
    } else {
      console.log(`[test-ae-digest] ✅ ${created.length} stamp(s) du jour supprimé(s) → cron prod de ce soir préservé.`);
    }
  } else {
    console.log(`[test-ae-digest] aucun stamp créé à nettoyer.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
