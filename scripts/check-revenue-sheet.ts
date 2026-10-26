/**
 * Contrôle du parsing du Sheet "Dashboard revenue 2026" : affiche, par rep, les
 * 3 flux (New / Renew AM / Renew CSM) avec leurs trimestres et leurs comptes.
 * Usage : npx tsx scripts/check-revenue-sheet.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchRevenueSheet } from "../lib/ae-activity/revenue-sheet";
import { fetchAccountTargets } from "../lib/ae-activity/account-targets";
import type { AccountTarget, RevenueStream } from "../lib/ae-activity/types";

const eur = (n: number | null): string => (n == null ? "-" : `${Math.round(n).toLocaleString("fr-FR")} €`);

/** Le détail par compte doit redonner, trimestre par trimestre, le total du rep. */
function checkAccounts(s: RevenueStream, accounts: AccountTarget[], withTargets: boolean): void {
  for (const q of s.quarters) {
    const i = Number(q.quarter.slice(1)) - 1;
    const t = accounts.reduce((x, a) => x + (a.quarters[i]?.target ?? 0), 0);
    const b = accounts.reduce((x, a) => x + (a.quarters[i]?.billed ?? 0), 0);
    if ((withTargets && Math.abs(t - (q.target ?? 0)) > 1) || Math.abs(b - (q.billed ?? 0)) > 1) {
      console.log(`    ⚠ ${q.quarter} comptes ${eur(b)}/${eur(withTargets ? t : null)} vs rep ${eur(q.billed)}/${eur(q.target)}`);
    }
  }
}

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
  const [sheet, byAccount] = await Promise.all([fetchRevenueSheet(), fetchAccountTargets()]);
  console.log(`durée: ${Date.now() - t0}ms  ok=${sheet.ok}  reps=${sheet.byRep.size}  détail par compte=${byAccount.ok ? "ok" : byAccount.error}\n`);

  for (const [key, rep] of [...sheet.byRep.entries()].sort()) {
    console.log(`── ${key}`);
    renderStream("New (AE)", rep.newBiz);
    if (byAccount.ok) checkAccounts(rep.newBiz, byAccount.forRep(key, "newBiz"), false);
    renderStream("Renew (AM)", rep.renew);
    if (byAccount.ok) checkAccounts(rep.renew, byAccount.forRep(key, "renew"), true);
    renderStream("Renew (CSM)", rep.csmRenew);
    if (byAccount.ok) checkAccounts(rep.csmRenew, byAccount.forRep(key, "csmRenew"), true);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
