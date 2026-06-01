import { db } from "../../lib/db";
import { fetchBillingRows, matchBillingRow } from "../../lib/billing/google-sheet";
import { runClientRefresh } from "../../lib/clients/run-refresh";
import { resolveCronUserId } from "../../lib/cron-user";

// Job mensuel : (1) sync facturation pour tous les clients 'done' (1 download
// du fichier revenue, match en mémoire), puis (2) refresh incrémental de chaque
// client 'done' (séquentiel, best-effort). Les appels Claude sont imputés au
// user résolu par resolveCronUserId (CRON_USER_ID / CRON_USER_EMAIL) plutôt
// qu'au système. Tourne en Background Function (runtime long).
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[clients-monthly-refresh-bg] unauthorized");
    return;
  }

  const { data: clients, error } = await db
    .from("clients")
    .select("id, company_name")
    .eq("enrichment_status", "done");

  if (error) {
    console.error("[clients-monthly-refresh-bg] failed to load clients:", error.message);
    return;
  }
  const list = clients ?? [];
  const cronUserId = await resolveCronUserId();
  console.log(
    `[clients-monthly-refresh-bg] ${list.length} clients 'done' à traiter (imputé à ${cronUserId ?? "système"})`,
  );

  // ── (1) Sync facturation — 1 seul download du fichier revenue ───────────────
  let billingUpdated = 0;
  try {
    const rows = await fetchBillingRows();
    if (rows.length > 0) {
      for (const c of list) {
        const billing = matchBillingRow(rows, c.company_name ?? "");
        if (billing.matched) {
          await db
            .from("clients")
            .update({ billing, billing_refreshed_at: new Date().toISOString() })
            .eq("id", c.id);
          billingUpdated++;
        }
      }
    }
    console.log(`[clients-monthly-refresh-bg] billing: ${billingUpdated}/${list.length} matchés`);
  } catch (e) {
    console.error("[clients-monthly-refresh-bg] billing sync failed:", e instanceof Error ? e.message : e);
  }

  // ── (2) Refresh incrémental — séquentiel, best-effort ───────────────────────
  let refreshed = 0;
  let skipped = 0;
  let errors = 0;
  for (const c of list) {
    try {
      const result = await runClientRefresh(c.id, cronUserId);
      if (!result.ok) errors++;
      else if ("skipped" in result) skipped++;
      else refreshed++;
    } catch (e) {
      errors++;
      console.error(`[clients-monthly-refresh-bg] ${c.id} threw:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `[clients-monthly-refresh-bg] DONE — refreshed ${refreshed}, skipped ${skipped}, errors ${errors}, billing ${billingUpdated}`,
  );
};
