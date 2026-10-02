import { db } from "../../lib/db";
import { fetchBillingRows, matchBillingRow } from "../../lib/billing/google-sheet";
import { resolveCronUserId } from "../../lib/cron-user";

// Job hebdo : (1) sync facturation pour tous les clients 'done' (1 seul
// download du fichier revenue, match en mémoire), puis (2) un refresh par
// client, chacun dans SA propre Background Function (clients-refresh-background,
// trigger "cron") : chaque refresh enchaîne plusieurs appels IA (1 à 2 min) et
// une boucle séquentielle ici dépasserait les 15 min de runtime au-delà d'une
// dizaine de clients. Les déclenchements sont espacés de 5 s pour lisser la
// charge Anthropic / HubSpot / Slack. Coûts IA imputés à resolveCronUserId.
const SPACING_MS = 5_000;

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[clients-weekly-refresh-bg] unauthorized");
    return;
  }
  const siteUrl = process.env.URL || process.env.SITE_URL;
  if (!siteUrl) {
    console.error("[clients-weekly-refresh-bg] missing URL/SITE_URL");
    return;
  }

  const { data: clients, error } = await db
    .from("clients")
    .select("id, company_name")
    .eq("enrichment_status", "done");
  if (error) {
    console.error("[clients-weekly-refresh-bg] failed to load clients:", error.message);
    return;
  }
  const list = clients ?? [];
  const cronUserId = await resolveCronUserId();
  console.log(`[clients-weekly-refresh-bg] ${list.length} clients 'done' (imputé à ${cronUserId ?? "système"})`);

  // ── (1) Sync facturation, 1 seul download du fichier revenue ──────────────
  let billingUpdated = 0;
  try {
    const rows = await fetchBillingRows();
    if (rows.length > 0) {
      for (const c of list) {
        const billing = matchBillingRow(rows, c.company_name ?? "");
        if (billing.matched) {
          await db.from("clients").update({ billing, billing_refreshed_at: new Date().toISOString() }).eq("id", c.id);
          billingUpdated++;
        }
      }
    }
    console.log(`[clients-weekly-refresh-bg] billing: ${billingUpdated}/${list.length} matchés`);
  } catch (e) {
    console.error("[clients-weekly-refresh-bg] billing sync failed:", e instanceof Error ? e.message : e);
  }

  // ── (2) Fan-out : un refresh par client ───────────────────────────────────
  let triggered = 0;
  let failed = 0;
  for (const c of list) {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/clients-refresh-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ id: c.id, userId: cronUserId, trigger: "cron" }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok || res.status === 202) triggered++;
      else {
        failed++;
        console.error(`[clients-weekly-refresh-bg] ${c.id} trigger HTTP ${res.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted") || msg.includes("timeout")) triggered++;
      else {
        failed++;
        console.error(`[clients-weekly-refresh-bg] ${c.id} trigger failed:`, msg);
      }
    }
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  console.log(`[clients-weekly-refresh-bg] DONE: ${triggered} refreshes triggered, ${failed} failed, billing ${billingUpdated}`);
};
