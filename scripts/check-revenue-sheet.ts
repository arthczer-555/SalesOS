/**
 * Contrôle du parsing du Sheet "Dashboard revenue 2026" : affiche, par rep, les
 * 3 flux (New / Renew AM / Renew CSM) avec leurs trimestres et leurs comptes.
 * Usage : npx tsx scripts/check-revenue-sheet.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchRevenueSheet } from "../lib/ae-activity/revenue-sheet";
import type { RevenueStream } from "../lib/ae-activity/types";

const eur = (n: number | null): string => (n == null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} €`);

function renderStream(label: string, s: RevenueStream): void {
  if (s.target == null && s.billed == null && s.accounts.length === 0) return;
  const pct = s.target && s.billed != null ? ` (${Math.round((s.billed / s.target) * 100)}%)` : "";
  console.log(`  ${label.padEnd(12)} ${eur(s.billed)} / ${eur(s.target)}${pct}`);
  const q = s.quarters
    .map((x) => `${x.quarter}: ${eur(x.billed)}/${eur(x.target)}`)
    .join("  ");
  if (q) console.log(`    ${q}`);
  if (s.accounts.length > 0) {
    const sum = s.accounts.reduce((acc, a) => acc + a.billed, 0);
    const top = s.accounts.slice(0, 5).map((a) => `${a.company} ${eur(a.billed)}`).join(", ");
    console.log(`    ${s.accounts.length} comptes, total ${eur(sum)} → ${top}${s.accounts.length > 5 ? ", …" : ""}`);
    if (s.billed != null && Math.abs(sum - s.billed) > 1) {
      console.log(`    ⚠ écart comptes vs facturé : ${eur(sum - s.billed)}`);
    }
  }
}

async function main() {
  const t0 = Date.now();
  const sheet = await fetchRevenueSheet();
  console.log(`durée: ${Date.now() - t0}ms  ok=${sheet.ok}  reps=${sheet.byRep.size}\n`);

  for (const [key, rep] of [...sheet.byRep.entries()].sort()) {
    console.log(`── ${key}`);
    renderStream("New (AE)", rep.newBiz);
    renderStream("Renew (AM)", rep.renew);
    renderStream("Renew (CSM)", rep.csmRenew);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
