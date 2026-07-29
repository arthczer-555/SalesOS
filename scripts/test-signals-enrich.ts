/**
 * Valide le moteur d'enrichissement lead sur des données réelles.
 *
 * Rejoue `enrichSignalLead` sur des signaux déjà en base (l'historique est un jeu
 * de test gratuit et représentatif) et mesure LE chiffre qui décide de la
 * viabilité du pipeline : le taux de survie. À 60 %, il faut ~17 candidats pour
 * remplir 10 places ; à 30 %, il en faut 33 et le budget de vagues explose.
 *
 * Ne dépense AUCUN crédit Apollo (People Search seul) et n'écrit jamais en base.
 *
 * Usage :
 *   npx tsx scripts/test-signals-enrich.ts
 *   npx tsx scripts/test-signals-enrich.ts --limit 30 --serp 10
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  // Imports dynamiques APRÈS dotenv : les modules lisent process.env au chargement.
  const { db } = await import("@/lib/db");
  const { enrichSignalLead, newEnrichContext } = await import("@/lib/signals/enrich-lead");
  const type = await import("@/lib/signals/types");
  void type;

  const arg = (n: string, d: number) => {
    const i = process.argv.indexOf(`--${n}`);
    if (i < 0) return d;
    const v = Number(process.argv[i + 1]);
    return Number.isFinite(v) ? v : d; // `|| d` avalerait --serp 0
  };
  const limit = arg("limit", 20);
  const serpBudget = arg("serp", 10);

  const { data, error } = await db
    .from("prospect_signals")
    .select(
      "id, feed, source, signal_type, company_name, scope_company_id, title, url, summary, why_relevant, suggested_action, score, signal_date, payload",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  console.log(`\n${rows.length} signaux chargés · budget SERP ${serpBudget} · 0 crédit Apollo\n`);

  const ctx = newEnrichContext({ serpBudget, deadlineMs: 10 * 60_000 });
  const started = Date.now();
  let ok = 0;
  const byLeadSource: Record<string, number> = {};
  const byEmailSource: Record<string, number> = {};
  const byVia: Record<string, number> = {};

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(
    pad("score", 6) + pad("société", 22) + pad("domaine (via)", 30) + pad("lead", 26) + pad("email", 34) + "ok",
  );
  console.log("-".repeat(124));

  for (const r of rows) {
    const payload = r.payload as { author?: { name: string; linkedin: string } } | null;
    const signal = {
      feed: r.feed,
      source: r.source,
      signal_type: r.signal_type,
      company_name: r.company_name,
      company_domain: null,
      scope_company_id: r.scope_company_id,
      category: null,
      title: r.title,
      url: r.url,
      summary: r.summary,
      why_relevant: r.why_relevant,
      suggested_action: r.suggested_action,
      score: r.score,
      signal_date: r.signal_date,
      author: payload?.author ?? null,
    } as Parameters<typeof enrichSignalLead>[0];

    const res = await enrichSignalLead(signal, ctx).catch((e) => {
      console.warn("  erreur:", e instanceof Error ? e.message : e);
      return null;
    });

    if (res) {
      ok++;
      byLeadSource[res.lead.source] = (byLeadSource[res.lead.source] ?? 0) + 1;
      byEmailSource[res.lead.email_source] = (byEmailSource[res.lead.email_source] ?? 0) + 1;
      byVia[res.domain_via ?? "none"] = (byVia[res.domain_via ?? "none"] ?? 0) + 1;
      console.log(
        pad(String(res.score), 6) +
          pad(String(res.company_name), 22) +
          pad(`${res.company_domain ?? "—"} (${res.domain_via ?? "—"})`, 30) +
          pad(`${res.lead.full_name}${res.lead.title ? ` / ${res.lead.title}` : ""}`, 26) +
          pad(`${res.lead.email ?? "à révéler"} [${res.lead.email_source}]`, 34) +
          "OUI",
      );
    } else {
      console.log(
        pad(String(r.score), 6) + pad(String(r.company_name), 22) + pad("—", 30) + pad("—", 26) + pad("—", 34) + "non",
      );
    }
  }

  const secs = Math.round((Date.now() - started) / 1000);
  const pct = rows.length ? Math.round((ok / rows.length) * 100) : 0;
  console.log("-".repeat(124));
  console.log(`\nTAUX DE SURVIE : ${ok}/${rows.length} (${pct}%) en ${secs}s`);
  console.log(`  rejets      : sans domaine ${ctx.drops.no_domain} · sans personne ${ctx.drops.no_person}`);
  console.log(`  domaine via : ${JSON.stringify(byVia)}`);
  console.log(`  lead via    : ${JSON.stringify(byLeadSource)}`);
  console.log(`  email via   : ${JSON.stringify(byEmailSource)}`);
  console.log(`  SERP consommés : ${serpBudget - ctx.domain.serpBudget.left}/${serpBudget}`);
  console.log(
    `\nLecture : sous ~50%, il faut élargir la récolte (plus de requêtes) pour garder 10 signaux/jour.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
