/**
 * Lance le pipeline Signals complet SANS rien insérer.
 *
 * Sert à deux choses :
 *  1. vérifier la chaîne de bout en bout avant de la laisser tourner en cron ;
 *  2. RECALIBRER LE SEUIL. La grille de score a changé d'échelle (l'actionnabilité
 *     en est sortie), donc `MIN_SCORE = 70` est une hypothèse, pas une mesure.
 *     `--dist` affiche la distribution complète pour trancher sur pièces.
 *
 * Usage :
 *   npx tsx scripts/test-signals-sweep.ts
 *   npx tsx scripts/test-signals-sweep.ts --only fr-people_move-drh,fr-funding
 *   npx tsx scripts/test-signals-sweep.ts --dist --only fr-people_move-drh
 *
 * `--only` est le mode de développement : itérer sur le prompt de scoring sans
 * relancer 46 requêtes SERP à chaque essai (2 requêtes coûtent 0,003 $).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

function list(name: string): string[] | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  return (process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const only = list("only");
  const wantDist = process.argv.includes("--dist");

  if (wantDist) {
    // Distribution : on court-circuite le sweep pour voir TOUS les scores, y
    // compris sous le seuil. C'est la seule façon de choisir le seuil sur pièces.
    const { collectGlobalNews, collectLinkedInPostDiscovery } = await import("@/lib/signals/sources");
    const { classifyItems } = await import("@/lib/signals/classify");

    const [news, posts] = await Promise.all([collectGlobalNews(only), collectLinkedInPostDiscovery(only)]);
    console.log(`\nRécolte : ${news.length} news + ${posts.length} posts`);
    const scored = await classifyItems([...news, ...posts], { userId: null });
    console.log(`Scoring : ${scored.length} signaux émis\n`);

    const buckets = new Map<number, number>();
    for (const s of scored) {
      const b = Math.floor(s.score / 5) * 5;
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    console.log("Distribution des scores :");
    for (const b of [...buckets.keys()].sort((a, b) => b - a)) {
      console.log(`  ${String(b).padStart(3)}-${b + 4}  ${"█".repeat(buckets.get(b) ?? 0)} ${buckets.get(b)}`);
    }

    console.log("\nSignaux entre 55 et 85 (la zone où se joue le seuil) :\n");
    for (const s of scored.filter((x) => x.score >= 55 && x.score <= 85).sort((a, b) => b.score - a.score)) {
      console.log(`  [${s.score}] ${s.company_name} · ${s.signal_type} · ${s.query_id ?? "?"}`);
      console.log(`        ${s.title}`);
      console.log(`        breakdown: ${JSON.stringify(s.score_breakdown ?? {})}`);
    }
    console.log("\nLire ces signaux et se demander : lequel mérite un mail ? Fixer MIN_SCORE là-dessus.\n");
    return;
  }

  const { runSignalsSweep } = await import("@/lib/signals/run-sweep");
  const started = Date.now();
  const res = await runSignalsSweep({ dryRun: true, onlyQueries: only });
  const secs = Math.round((Date.now() - started) / 1000);

  console.log(`\n=== SWEEP À BLANC (aucune insertion) — ${secs}s ===`);
  console.log(`  items récoltés     : ${res.collected}`);
  console.log(`  au-dessus du seuil : ${res.scored}`);
  console.log(`  net-nouveaux       : ${res.candidates}`);
  console.log(`  tentatives d'enrichissement : ${res.enrichAttempts}`);
  console.log(`  jetés sans domaine : ${res.droppedNoDomain}`);
  console.log(`  jetés sans personne: ${res.droppedNoPerson}`);
  console.log(`  auraient été insérés : ${res.enrichAttempts > 0 ? "voir logs [signals/sweep]" : 0}`);
  console.log(`  expirés (rétention) : ${res.expired}`);
  if (res.error) console.log(`  ERREUR : ${res.error}`);
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
