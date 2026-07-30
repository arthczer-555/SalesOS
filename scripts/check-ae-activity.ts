/**
 * Contrôle des métriques d'activité d'un rep : appels (dont conversation > 1 min
 * et cold call), emails sortants, meetings, deals. Compare aux totaux HubSpot.
 * Usage : npx tsx scripts/check-ae-activity.ts [ownerId]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchDispositionLabelMap, fetchOwnerHubspot, fetchSalesPipelineStages } from "../lib/ae-activity/fetch-hubspot";
import { fetchMarketingLeads } from "../lib/ae-activity/leads";
import { listSalesReps } from "../lib/ae-activity/reps";
import { bucketize } from "../lib/ae-activity/aggregate";
import { CONNECTED_CALL_MIN_MS } from "../lib/ae-activity/types";

async function main() {
  const start = process.env.AE_ACTIVITY_START || "2026-01-01";
  const end = new Date().toISOString().slice(0, 10);
  const wantedOwner = process.argv[2];

  const [stages, dispositionMap, leads, reps] = await Promise.all([
    fetchSalesPipelineStages(),
    fetchDispositionLabelMap(),
    fetchMarketingLeads(start),
    listSalesReps(),
  ]);

  const targets = wantedOwner ? reps.filter((r) => r.ownerId === wantedOwner) : reps;
  console.log(`période ${start} → ${end}, seuil conversation ${CONNECTED_CALL_MIN_MS / 1000}s\n`);

  for (const rep of targets) {
    const t0 = Date.now();
    const hs = await fetchOwnerHubspot(rep.ownerId, { startDay: start, endDay: end, stages, dispositionMap, leads });
    const b = bucketize(hs.raw, [], [], [], "quarter");
    const tot = b.reduce(
      (acc, x) => ({
        out: acc.out + x.outboundCalls,
        conn: acc.conn + x.connectedCalls,
        connCold: acc.connCold + x.connectedColdCalls,
        cold: acc.cold + x.callsCold,
        onDeal: acc.onDeal + x.callsOnDeal,
        emails: acc.emails + x.emailsOut,
        emailsCold: acc.emailsCold + x.emailsCold,
        emailsOnDeal: acc.emailsOnDeal + x.emailsOnDeal,
        meetings: acc.meetings + x.meetingsScheduled,
        won: acc.won + x.closedWon,
      }),
      { out: 0, conn: 0, connCold: 0, cold: 0, onDeal: 0, emails: 0, emailsCold: 0, emailsOnDeal: 0, meetings: 0, won: 0 },
    );
    const rate = tot.out > 0 ? Math.round((tot.conn / tot.out) * 100) : 0;
    // Taux affiché dans l'UI : conversations sur les seuls cold calls.
    const coldRate = tot.cold > 0 ? Math.round((tot.connCold / tot.cold) * 100) : 0;
    const classified = tot.cold + tot.onDeal;
    const emailsClassified = tot.emailsCold + tot.emailsOnDeal;

    console.log(`── ${rep.name} (${rep.ownerId})  ${Date.now() - t0}ms`);
    console.log(`   appels sortants : ${tot.out}  dont conversation : ${tot.conn} (${rate}% tous appels)`);
    console.log(`   cold : ${tot.cold}  dont conversation : ${tot.connCold} (${coldRate}% ← taux affiché)  sur un deal : ${tot.onDeal}  classés : ${classified}/${tot.out}`);
    console.log(`   emails sortants : ${tot.emails}  cold : ${tot.emailsCold}  sur un deal : ${tot.emailsOnDeal}  classés : ${emailsClassified}/${tot.emails}`);
    console.log(`   meetings : ${tot.meetings}   deals gagnés : ${tot.won}`);
    if (hs.warnings.length) console.log(`   ⚠ warnings : ${hs.warnings.join(", ")}`);
    if (classified !== tot.out) console.log(`   ⚠ ${tot.out - classified} appels non classés (associations indispo)`);
    if (emailsClassified !== tot.emails) console.log(`   ⚠ ${tot.emails - emailsClassified} emails non classés (associations indispo)`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
