/**
 * Rattrapage du "pain" (ce qui a poussé l'entreprise vers le coaching) sur les
 * deal recaps générés avant le 2026-10-29.
 *
 * Même contexte et même prompt que l'enrichissement (loadClientContext +
 * qualification HubSpot Need + generateDealRecap) : on régénère le recap mais on
 * n'en garde QUE le pain, fusionné dans le recap existant relu juste avant
 * l'écriture. Timeline, objections, promesses (et leurs retouches manuelles)
 * ne bougent pas. API Anthropic (Haiku, ~0,05 $ par fiche).
 *
 * Usage :
 *   node --env-file=.env.local --no-warnings --import ./scripts/ts-hooks/register.mjs \
 *     scripts/backfill-recap-pain.mts [--ids uuid1,uuid2] [--limit N] [--dry]
 *
 *   --ids    fiches précises (sinon toutes celles dont le recap n'a pas de pain)
 *   --limit  s'arrête après N fiches
 *   --dry    génère et affiche le pain sans rien écrire
 *
 * Reprise : une fiche qui a déjà un pain est sautée.
 */
import { db } from "@/lib/db";
import { loadClientContext } from "@/lib/clients/context";
import { generateDealRecap } from "@/lib/clients/deal-recap";
import { fetchHubspotDealFields } from "@/lib/clients/hubspot-fields";
import { mergedDealIdsOf } from "@/lib/clients/merge";
import type { AccountCompany, ClientRow, DealRecap } from "@/lib/clients/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dry = flag("dry");
const limit = value("limit") ? Number(value("limit")) : Infinity;
const ids = value("ids")?.split(",").map((s) => s.trim()).filter(Boolean);

let query = db.from("clients").select("*").not("deal_recap", "is", null).not("hubspot_deal_id", "is", null);
if (ids?.length) query = query.in("id", ids);
const { data, error } = await query;
if (error) {
  console.error(`Lecture des fiches impossible : ${error.message}`);
  process.exit(1);
}

const todo = ((data ?? []) as ClientRow[]).filter((r) => !(r.deal_recap as DealRecap | null)?.pain).slice(0, limit);
console.log(`${todo.length} fiche(s) à traiter${dry ? " (dry run, aucune écriture)" : ""}\n`);

let done = 0;
let empty = 0;
let failed = 0;
for (const row of todo) {
  const label = `${row.company_name} (${row.id})`;
  try {
    const confirmed = Array.isArray(row.confirmed_claap_recordings)
      ? (row.confirmed_claap_recordings as Array<{ recording_id?: string }>)
          .map((r) => r.recording_id)
          .filter((id): id is string => !!id)
      : null;
    const declined = (row.declined_claap_recording_ids as string[] | null) ?? [];
    const accountCompanyIds = ((row.account_companies as AccountCompany[] | null | undefined) ?? []).map((c) => c.id);
    const ctx = await loadClientContext(row.hubspot_deal_id, {
      confirmedRecordingIds: confirmed && confirmed.length > 0 ? confirmed : undefined,
      excludeRecordingIds: declined.length > 0 ? declined : undefined,
      accountCompanyIds,
      extraDealIds: mergedDealIdsOf(row),
    });
    const hs = await fetchHubspotDealFields(row.hubspot_deal_id);
    const recap = await generateDealRecap(ctx, null, hs);
    if (!recap) throw new Error("pas de réponse du modèle (ANTHROPIC_API_KEY absente ?)");

    if (!recap.pain) {
      empty++;
      console.log(`· ${label} : pas de pain trouvé dans le contexte`);
      continue;
    }
    console.log(`✓ ${label}\n  ${recap.pain}\n`);
    if (dry) {
      done++;
      continue;
    }

    // Relu juste avant l'écriture : une retouche faite pendant la génération
    // n'est pas écrasée, et un pain écrit à la main entre-temps est gardé.
    const { data: fresh, error: readErr } = await db.from("clients").select("deal_recap").eq("id", row.id).single();
    if (readErr) throw new Error(readErr.message);
    const current = (fresh?.deal_recap ?? null) as DealRecap | null;
    if (!current || current.pain) continue;
    const { error: writeErr } = await db
      .from("clients")
      .update({ deal_recap: { ...current, pain: recap.pain }, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (writeErr) throw new Error(writeErr.message);
    done++;
  } catch (e) {
    failed++;
    console.error(`✗ ${label} : ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\nTerminé : ${done} pain(s) ${dry ? "générés" : "écrits"}, ${empty} sans pain, ${failed} échec(s).`);
