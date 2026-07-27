/**
 * Contrôle de cohérence du Deal Review : compare les chiffres produits par
 * buildDealReview() aux valeurs relevées directement dans HubSpot.
 * Usage : npx tsx <ce fichier>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildDealReview } from "../lib/deal-review/build";

async function main() {
  const t0 = Date.now();
  const d = await buildDealReview();
  console.log(`durée: ${Date.now() - t0}ms  warnings: ${JSON.stringify(d.warnings)}`);
  console.log(`periodStart: ${d.periodStart}`);
  console.log(`deals renvoyés (nurture inclus): ${d.deals.length}`);
  console.log(`totals.openDeals (hors nurture): ${d.totals.openDeals}`);
  console.log(
    `totals: pipeline=${Math.round(d.totals.pipeline)} médTouch=${d.totals.medianTouchPoints} stalled=${d.totals.stalledCount} sansContact=${d.totals.staleContactCount} sansSuite=${d.totals.noNextActivityCount}`,
  );
  console.log(
    `won=${d.totals.closedWon} lost=${d.totals.closedLost} winRate=${d.totals.winRate}%`,
  );
  console.log(
    `wonBenchmark: médTouch=${d.wonBenchmark.medianTouchPoints} (n=${d.wonBenchmark.sample}) | lost médTouch=${d.wonBenchmark.lostMedianTouchPoints} (n=${d.wonBenchmark.lostSample}) | cycle=${d.wonBenchmark.medianDaysToClose}j`,
  );

  console.log("\n--- Étapes ---");
  for (const s of d.stages) {
    console.log(
      `${String(s.openDeals).padStart(3)} deals | méd ${String(s.medianTouchPoints ?? "null").padStart(5)} | ${Math.round(s.pipeline).toString().padStart(8)} € | ${s.stageLabel}`,
    );
  }
  const nurture = d.deals.filter((x) => x.isNurture).length;
  console.log(`(nurture: ${nurture} deals, exclus des étapes ci-dessus)`);

  console.log("\n--- Par owner ---");
  for (const r of d.reps) {
    console.log(
      `${r.ownerName.padEnd(22)} ${r.isSalesUser ? "AE " : "   "} deals=${String(r.openDeals).padStart(3)} pipe=${Math.round(r.pipeline).toString().padStart(8)} médTouch=${String(r.medianTouchPoints ?? "-").padStart(5)} stalled=${String(r.stalledCount).padStart(3)} win=${String(r.winRate ?? "-").padStart(4)}% (${r.closedWon}/${r.closedWon + r.closedLost}) cycle=${r.medianDaysToClose ?? "-"} touchesToClose=${r.medianTouchesToClose ?? "-"}`,
    );
  }

  const sumReps = d.reps.reduce((s, r) => s + r.openDeals, 0);
  console.log(`\nSomme deals par owner = ${sumReps} (doit égaler totals.openDeals = ${d.totals.openDeals})`);

  console.log("\n--- Échantillon de 5 lignes ---");
  for (const x of d.deals.filter((v) => !v.isNurture).slice(0, 5)) {
    console.log(
      `${x.dealname.slice(0, 28).padEnd(28)} ${x.stageLabel.slice(0, 22).padEnd(22)} ${String(x.amount ?? "—").padStart(7)} score=${x.score ?? "—"} touch=${x.touchPoints} claap=${x.claapCalls}/${x.claapAvgScore?.toFixed(1) ?? "—"} stage=${x.daysInStage}j contact=${x.daysSinceContact}j stalled=${x.isStalled} next=${x.nextActivityAt ? "oui" : "non"}`,
    );
  }
  console.log("\n--- Distribution des alertes (hors nurture) ---");
  const act = d.deals.filter((x) => !x.isNurture);
  const rate = (n: number) => `${n}/${act.length} (${Math.round((n / act.length) * 100)}%)`;
  console.log(`jamais touché (touch=0) : ${rate(act.filter((x) => x.touchPoints === 0).length)}`);
  console.log(`stalled                 : ${rate(act.filter((x) => x.isStalled).length)}`);
  console.log(`0 contact               : ${rate(act.filter((x) => x.numContacts === 0).length)}`);
  console.log(`<=1 contact             : ${rate(act.filter((x) => x.numContacts <= 1).length)}`);
  console.log(`sans prochaine étape    : ${rate(act.filter((x) => !x.nextActivityAt).length)}`);
  console.log(`montant vide            : ${rate(act.filter((x) => x.amount == null).length)}`);

  const scored = d.deals.filter((x) => x.score != null).length;
  const withClaap = d.deals.filter((x) => x.claapCalls > 0).length;
  console.log(`\ndeals scorés IA: ${scored}/${d.deals.length} | avec meeting Claap: ${withClaap}`);
}

main().then(() => process.exit(0));
