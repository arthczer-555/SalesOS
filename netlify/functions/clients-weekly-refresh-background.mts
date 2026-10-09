import { db } from "../../lib/db";
import { fetchBillingRows } from "../../lib/billing/google-sheet";
import { resolveCronUserId } from "../../lib/cron-user";
import { matchClientBilling } from "../../lib/clients/billing-link";
import type { MergedClient } from "../../lib/clients/types";

// Colonnes de migrations optionnelles (clients_merge.sql,
// clients_billing_link.sql) : retirées de la lecture tant qu'elles manquent.
const OPTIONAL_COLUMNS = ["merged_clients", "billing_sheet_rows"];

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

  // merged_clients : noms des fiches absorbées par une fusion, matchés aussi dans
  // le sheet revenue. billing_sheet_rows : lignes reliées à la main, qui
  // remplacent le match par nom (cf. lib/clients/billing-link.ts).
  const load = (columns: string[]) => db.from("clients").select(columns.join(", ")).eq("enrichment_status", "done");
  let columns = ["id", "company_name", ...OPTIONAL_COLUMNS];
  let { data: clients, error } = await load(columns);
  for (let i = 0; i < OPTIONAL_COLUMNS.length && error; i++) {
    const message = error.message;
    const missing = OPTIONAL_COLUMNS.find((c) => columns.includes(c) && message.includes(c));
    if (!missing) break;
    columns = columns.filter((c) => c !== missing);
    ({ data: clients, error } = await load(columns));
  }
  if (error) {
    console.error("[clients-weekly-refresh-bg] failed to load clients:", error.message);
    return;
  }
  const list = (clients ?? []) as unknown as Array<{
    id: string;
    company_name: string;
    merged_clients?: MergedClient[] | null;
    billing_sheet_rows?: string[] | null;
  }>;
  const cronUserId = await resolveCronUserId();
  console.log(`[clients-weekly-refresh-bg] ${list.length} clients 'done' (imputé à ${cronUserId ?? "système"})`);

  // ── (1) Sync facturation, 1 seul download du fichier revenue ──────────────
  let billingUpdated = 0;
  try {
    const rows = await fetchBillingRows();
    if (rows.length > 0) {
      for (const c of list) {
        const billing = matchClientBilling(rows, c);
        // Lien manuel dont les lignes ont disparu du sheet : écrit aussi, la
        // fiche doit le dire au lieu d'afficher l'ancien montant.
        if (billing.matched || billing.match_source === "manual") {
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
