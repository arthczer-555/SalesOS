/**
 * Analyse de perte en masse des deals closed lost du Sales Pipeline, sur
 * l'ABONNEMENT Claude (Claude Code en mode headless, `claude -p`), pas l'API.
 *
 * Même contexte, même prompt et même schéma que le bouton "Analyze the loss" de
 * l'app (prepareLossAnalysis / finalizeLossAnalysis de lib/deals/run-loss-analysis.ts) :
 * seul l'exécutant du modèle change. Écrit dans deal_loss_analyses comme l'app.
 * Aucune écriture HubSpot (raison corrigée, tâche de relance : au clic dans l'app).
 *
 * Usage :
 *   node --env-file=.env.local --no-warnings --import ./scripts/ts-hooks/register.mjs \
 *     scripts/loss-analysis-batch.mts [--ids 123,456] [--limit 20] [--force] [--concurrency 3] [--dry]
 *
 *   --ids          deals précis (sinon tous les closed lost, plus récent d'abord)
 *   --limit N      s'arrête après N deals traités
 *   --force        réanalyse aussi les deals déjà analysés au format courant
 *   --concurrency  appels `claude -p` en parallèle (3 par défaut)
 *   --dry          construit les contextes sans appeler le modèle
 *   --sync-columns remplit reopen_date / owner_id des analyses faites avant la
 *                  migration deals_next_move_reopen_chat.sql, puis s'arrête
 *
 * Reprise : un deal déjà analysé au format courant est sauté, donc relancer la
 * même commande reprend là où le run s'est arrêté. Si l'abonnement atteint sa
 * limite d'usage, le script s'arrête proprement (code 2) : relancer plus tard.
 *
 * Facturation : le process enfant tourne SANS ANTHROPIC_API_KEY (chargée par
 * --env-file pour le reste du code), sinon le CLI facturerait l'API. Pas de
 * --bare (il exige une clé API). MCP, réglages, skills et outils sont coupés :
 * sans ça chaque appel embarquait ~178k tokens de contexte inutile.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { LOSS_ANALYSIS_SCHEMA_VERSION } from "@/lib/deals/loss-analysis";
import {
  LOSS_SYSTEM_PROMPT,
  finalizeLossAnalysis,
  lossAnalysisTool,
  persistLossAnalysis,
  prepareLossAnalysis,
} from "@/lib/deals/run-loss-analysis";

// ─── Arguments ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY_IDS = option("ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const LIMIT = Number(option("limit")) || Infinity;
const FORCE = flag("force");
const DRY = flag("dry");
const SYNC_COLUMNS = flag("sync-columns");
const CONCURRENCY = Math.max(1, Number(option("concurrency")) || 3);
const CALL_TIMEOUT_MS = 10 * 60_000;

// Le prompt de l'app demande l'outil loss_analysis ; ici la sortie passe par
// --json-schema (outil StructuredOutput du CLI).
const TOOL_LINE = "Utilise l'outil loss_analysis pour répondre.";
if (!LOSS_SYSTEM_PROMPT.includes(TOOL_LINE)) throw new Error("LOSS_SYSTEM_PROMPT a changé : mettre à jour TOOL_LINE");
const SYSTEM_PROMPT = LOSS_SYSTEM_PROMPT.replace(TOOL_LINE, "Réponds uniquement via la sortie structurée demandée.");
const SCHEMA = JSON.stringify(lossAnalysisTool.input_schema);

// Dossier vide : aucun CLAUDE.md ni fichier de projet à découvrir.
const CWD = mkdtempSync(path.join(tmpdir(), "loss-batch-"));
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.ANTHROPIC_API_KEY;

// ─── Liste des deals ───────────────────────────────────────────────────────

async function closedLostDealIds(): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const res = await hubspotFetch<{ results?: { id: string }[]; paging?: { next?: { after?: string } } }>(
      "/crm/v3/objects/deals/search",
      "POST",
      {
        filterGroups: [{ filters: [
          { propertyName: "pipeline", operator: "EQ", value: "default" },
          { propertyName: "hs_is_closed_lost", operator: "EQ", value: "true" },
        ] }],
        sorts: [{ propertyName: "hs_v2_date_entered_closedlost", direction: "DESCENDING" }],
        properties: ["dealname"],
        limit: 200,
        ...(after ? { after } : {}),
      },
    );
    ids.push(...(res.results ?? []).map((r) => r.id));
    after = res.paging?.next?.after;
  } while (after);
  return ids;
}

async function currentAnalyses(): Promise<Set<string>> {
  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("deal_loss_analyses")
      .select("deal_id, status, schema_version:analysis->>schemaVersion")
      .range(from, from + 999);
    if (error) throw new Error(`deal_loss_analyses: ${error.message}`);
    for (const r of (data ?? []) as { deal_id: string; status: string; schema_version: string | null }[]) {
      if (r.status === "done" && r.schema_version === String(LOSS_ANALYSIS_SCHEMA_VERSION)) done.add(r.deal_id);
    }
    if ((data ?? []).length < 1000) return done;
  }
}

// ─── Appel du modèle via l'abonnement ──────────────────────────────────────

class UsageLimitError extends Error {}

type CliResult = { is_error?: boolean; result?: string; structured_output?: unknown; modelUsage?: Record<string, unknown>; api_error_status?: number | null };

const LIMIT_PATTERN = /usage limit|rate limit|limit reached|quota|429|overloaded/i;

function runClaude(context: string): Promise<{ output: unknown; model: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model", "sonnet",
        "--system-prompt", SYSTEM_PROMPT,
        "--json-schema", SCHEMA,
        "--output-format", "json",
        "--tools", "",
        "--no-session-persistence",
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
        "--setting-sources", "",
        "--disable-slash-commands",
      ],
      { cwd: CWD, env: CHILD_ENV, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), CALL_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: CliResult | null = null;
      try { parsed = JSON.parse(out) as CliResult; } catch { /* sortie non JSON */ }
      const detail = (parsed?.result ?? err ?? out).toString().slice(0, 300);
      if (!parsed || code !== 0 || parsed.is_error || !parsed.structured_output) {
        if (parsed?.api_error_status === 429 || LIMIT_PATTERN.test(detail)) return reject(new UsageLimitError(detail));
        return reject(new Error(`claude -p failed (exit ${code}): ${detail || "no output"}`));
      }
      const model = Object.keys(parsed.modelUsage ?? {}).find((m) => m.includes("sonnet")) ?? "sonnet";
      resolve({ output: parsed.structured_output, model: `${model} (Claude Code)` });
    });
    child.stdin.end(context);
  });
}

// ─── Boucle ────────────────────────────────────────────────────────────────

const stamp = () => new Date().toISOString().slice(11, 19);

async function analyzeOne(dealId: string): Promise<"done" | "dry"> {
  const prepared = await prepareLossAnalysis(dealId);
  if (DRY) {
    console.log(`${stamp()} [dry] ${dealId} contexte ${prepared.context.length} car., sources ${JSON.stringify(prepared.sources)}`);
    return "dry";
  }
  await db
    .from("deal_loss_analyses")
    .upsert({ deal_id: dealId, status: "analyzing", error_message: null, updated_at: new Date().toISOString() }, { onConflict: "deal_id" });
  try {
    const { output, model } = await runClaude(prepared.context);
    const analysis = finalizeLossAnalysis(output, prepared);
    await persistLossAnalysis(dealId, analysis, model, prepared.ownerId);
    console.log(`${stamp()} done ${dealId} ${analysis.primaryReason ?? "unclear"}, reopen ${analysis.reopen.date ?? "none"}`);
    return "done";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .from("deal_loss_analyses")
      .update({
        status: "error",
        error_message: e instanceof UsageLimitError ? `Paused: subscription usage limit (${msg})` : msg,
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId);
    throw e;
  }
}

// Analyses faites avant la migration : colonnes de tri vides. La date vient du
// JSON de l'analyse, l'owner de HubSpot (batch/read par 100).
async function syncColumns() {
  const { data, error } = await db
    .from("deal_loss_analyses")
    .select("deal_id, reopen:analysis->reopen->>date, schema_version:analysis->>schemaVersion")
    .eq("status", "done")
    .or("reopen_date.is.null,owner_id.is.null");
  if (error) throw new Error(`deal_loss_analyses: ${error.message} (migration appliquée ?)`);
  const rows = ((data ?? []) as { deal_id: string; reopen: string | null; schema_version: string | null }[])
    .filter((r) => r.schema_version === String(LOSS_ANALYSIS_SCHEMA_VERSION));
  let updated = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const batch = await hubspotFetch<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
      "/crm/v3/objects/deals/batch/read",
      "POST",
      { inputs: chunk.map((r) => ({ id: r.deal_id })), properties: ["hubspot_owner_id"] },
    );
    const owners = new Map((batch.results ?? []).map((d) => [d.id, d.properties.hubspot_owner_id ?? null]));
    for (const r of chunk) {
      const { error: upErr } = await db
        .from("deal_loss_analyses")
        .update({ reopen_date: r.reopen, owner_id: owners.get(r.deal_id) ?? null })
        .eq("deal_id", r.deal_id);
      if (upErr) throw new Error(`update ${r.deal_id}: ${upErr.message}`);
      updated++;
    }
  }
  console.log(`${stamp()} colonnes synchronisées : ${updated} analyses`);
}

async function main() {
  if (SYNC_COLUMNS) {
    await syncColumns();
    process.exit(0);
  }
  const all = ONLY_IDS ?? (await closedLostDealIds());
  const skip = FORCE || DRY ? new Set<string>() : await currentAnalyses();
  const todo = all.filter((id) => !skip.has(id)).slice(0, LIMIT);
  console.log(`${stamp()} ${all.length} deals closed lost, ${all.length - all.filter((id) => !skip.has(id)).length} déjà analysés, ${todo.length} à traiter (concurrence ${CONCURRENCY}${DRY ? ", dry" : ""})`);

  let next = 0;
  let ok = 0;
  let failed = 0;
  let paused = false;
  const worker = async () => {
    while (!paused && next < todo.length) {
      const dealId = todo[next++];
      try {
        await analyzeOne(dealId);
        ok++;
      } catch (e) {
        if (e instanceof UsageLimitError) {
          paused = true;
          console.error(`${stamp()} limite d'usage de l'abonnement atteinte sur ${dealId} : ${e.message}`);
        } else {
          failed++;
          console.error(`${stamp()} error ${dealId}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if ((ok + failed) % 10 === 0) console.log(`${stamp()} progression : ${ok} ok, ${failed} erreurs, ${todo.length - next} restants`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`${stamp()} terminé : ${ok} ok, ${failed} erreurs${paused ? ", EN PAUSE (limite d'usage) : relancer la même commande plus tard" : ""}`);
  process.exit(paused ? 2 : failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
