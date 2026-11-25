/**
 * Banc de test de la bascule HubSpot (plan : __documentation/hubspot-pipeline-switch-plan.md).
 *
 * Crée et fait vivre des cartes "TEST - ..." dans le pipeline Prospection, avec
 * les MÊMES fonctions que le Lead Manager et le Sales Coach (lib/hubspot/deal-writes.ts).
 * Toutes les écritures sont journalisées dans hubspot_write_log (is_test = true).
 * Contacts de test : salesos-test-a@example.com et salesos-test-b@example.org
 * (domaines réservés : aucun email ne peut partir, aucune vraie personne touchée).
 *
 * Usage :
 *   node --env-file=.env.local --no-warnings --import ./scripts/ts-hooks/register.mjs scripts/test-switch.mts <commande> [options]
 *
 * Lecture seule :
 *   status                      réglages, cartes TEST (état HubSpot actuel), dernières écritures
 *   model                       contrôle du modèle de pipelines contre HubSpot
 *   log [--deal ID] [--limit N] journal des écritures
 *
 * Écritures (HubSpot) :
 *   create --card a|b [--source Inbound] [--offer ai-roleplay,human-coaching] [--name "Acme"] [--dry]
 *   move --deal ID [--dry]                 R1 scheduled -> Scoping (SQL)
 *   score --deal ID --value N [--dry]      écrit score_medic_kuna (le workflow 01 range la carte)
 *   meeting --card a|b [--deal ID] [--unsure] [--score N] [--kind discovery_r1]
 *                                          simule un meeting analysé (rec_test_...) et lance le parcours
 *                                          réel : rapprochement, passage en Scoping, score, ou demande de ✅
 *                                          (sans --deal : la carte est trouvée par le rapprochement, leads d'abord)
 *   confirm --deal ID [--yes|--no]         traite la réponse à une demande de confirmation : lit la
 *                                          réaction ✅ / ❌ posée sur le DM (API Slack) et la passe au
 *                                          même code que l'app déployée ; --yes / --no la simule
 *   refuse --deal ID                       vérifie qu'une carte réelle est refusée (n'écrit rien)
 *   cleanup [--archive]                    liste les cartes TEST ; --archive les archive dans HubSpot
 *
 * Réglages (Supabase, guide_defaults) :
 *   set KEY VALUE [--force]                --force : valeur live avant le 30/11
 *   cutover-at ISO|none                    fixe l'instant de bascule (on_new)
 */
import { db } from "@/lib/db";
import { hubspotArchive, hubspotFetch } from "@/lib/hubspot";
import { TEST_FIXTURES, ensureTestFixture, type TestFixtureKey } from "@/lib/hubspot/test-fixtures";
import {
  CUTOVER_DATE,
  CUTOVER_SETTINGS,
  isCutoverKey,
  loadCutoverState,
  setCutoverInstant,
  setCutoverSetting,
} from "@/lib/hubspot/cutover";
import {
  REFUSAL_LABELS,
  createProspectionDeal,
  moveR1ToScoping,
  readGuardDeal,
  recordScoreHistory,
  writeQualificationScore,
  type Refusal,
} from "@/lib/hubspot/deal-writes";
import {
  ENROLLMENT_REASON_LABELS,
  assertPipelineModel,
  getStageLabels,
  isTestDealName,
  scoreBand,
} from "@/lib/hubspot/pipeline-model";
import { closeWrite, listWrites, openWrite } from "@/lib/hubspot/write-log";
import { DEAL_ORIGINS, DEFAULT_DEAL_ORIGIN, isDealOrigin, isOfferType } from "@/lib/leads/origin";
import { TEST_RECORDING_PREFIX, resolveMeetingCard } from "@/lib/sales-coach/deal-match";
import { processCardConfirmation, runCardFlowAfterAnalysis } from "@/lib/sales-coach/card-flow";
import type { ScoreOneDealResult } from "@/lib/deal-scoring";
import { parseConfirmationAnswer } from "@/lib/slack/confirmations";

const ACTOR = "test-switch";

const FIXTURES = TEST_FIXTURES;
type FixtureKey = TestFixtureKey;

const argv = process.argv.slice(2);
const command = argv[0] ?? "status";
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dry = flag("dry");

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function printRefusal(r: Refusal) {
  console.log(`✖ refused: ${r.reason} (${REFUSAL_LABELS[r.reason]})${r.detail ? `\n  detail: ${r.detail}` : ""}`);
}

async function resolveOwnerId(): Promise<string> {
  const explicit = opt("owner");
  if (explicit) return explicit;
  const { data, error } = await db
    .from("users")
    .select("name, hubspot_owner_id")
    .eq("is_admin", true)
    .ilike("name", "%arthur%")
    .not("hubspot_owner_id", "is", null);
  if (error) die(`users lookup failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length !== 1) die(`cannot pick the owner automatically (${rows.length} candidates): pass --owner <hubspotOwnerId>`);
  return rows[0].hubspot_owner_id as string;
}

async function testDealIds(): Promise<string[]> {
  const rows = await listWrites({ testOnly: true, action: "create_deal", limit: 200 });
  return [...new Set(rows.filter((r) => r.status === "done" && r.object_id).map((r) => r.object_id as string))];
}

async function readDeals(ids: string[]) {
  if (!ids.length) return [];
  const res = await hubspotFetch<{ results?: { id: string; properties: Record<string, string | null>; archived?: boolean }[] }>(
    "/crm/v3/objects/deals/batch/read",
    "POST",
    { inputs: ids.slice(0, 100).map((id) => ({ id })), properties: ["dealname", "pipeline", "dealstage", "score_medic_kuna", "origin", "type_offre", "sale_type", "forced_move", "createdate"] },
  );
  return res.results ?? [];
}

async function cmdStatus() {
  const state = await loadCutoverState();
  console.log(`\n== Settings (cutover date ${CUTOVER_DATE}, cutover instant: ${state.cutoverAt ?? "not set"}) ==`);
  for (const key of Object.keys(CUTOVER_SETTINGS) as (keyof typeof CUTOVER_SETTINGS)[]) {
    const def = CUTOVER_SETTINGS[key].default;
    const v = state.values[key];
    console.log(`  ${key.padEnd(32)} ${String(v).padEnd(12)}${v !== def ? ` (default ${def})` : ""}`);
  }
  const { stages, pipelines } = await getStageLabels();
  let ids: string[];
  try {
    ids = await testDealIds();
  } catch (e) {
    console.log(`\n✖ ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const deals = await readDeals(ids);
  console.log(`\n== TEST cards (${deals.length}) ==`);
  for (const d of deals) {
    const p = d.properties;
    const score = p.score_medic_kuna ? Number(p.score_medic_kuna) : null;
    console.log(
      `  ${d.id}  ${p.dealname}\n     ${pipelines[p.pipeline ?? ""] ?? p.pipeline} / ${stages[p.dealstage ?? ""] ?? p.dealstage}` +
        ` | score ${score ?? "-"}${score !== null ? ` (${scoreBand(score)})` : ""} | Source ${p.origin ?? "-"} | offer ${p.type_offre ?? "-"} | sale_type ${p.sale_type ?? "-"} | forced_move ${p.forced_move ?? "-"}`,
    );
  }
  await cmdLog(8);
}

async function cmdLog(limit = Number(opt("limit") ?? 20)) {
  const rows = await listWrites({ objectId: opt("deal"), limit });
  console.log(`\n== Write log (last ${rows.length}) ==`);
  for (const r of rows.reverse()) {
    console.log(
      `  ${r.created_at.slice(0, 19).replace("T", " ")}  ${r.status.padEnd(7)} ${r.action.padEnd(15)} ${r.object_type}/${r.object_id ?? "-"}` +
        `  by ${r.triggered_by}${r.is_test ? " [TEST]" : ""}${r.mode ? ` mode=${r.mode}` : ""}${r.error ? `\n     error: ${r.error}` : ""}`,
    );
  }
}

async function cmdModel() {
  const r = await assertPipelineModel();
  console.log(r.ok ? "✔ pipeline model OK" : "✖ pipeline model NOT OK");
  for (const [k, v] of Object.entries(r)) if (Array.isArray(v) && v.length) console.log(`  ${k}: ${v.join(" ; ")}`);
}

async function cmdCreate() {
  const card = (opt("card") ?? "a") as FixtureKey;
  if (!(card in FIXTURES)) die("--card must be a or b");
  const source = opt("source") ?? DEFAULT_DEAL_ORIGIN;
  if (!isDealOrigin(source)) die(`--source must be one of: ${DEAL_ORIGINS.map((o) => `"${o.value}"`).join(", ")}`);
  const offers = (opt("offer") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const badOffer = offers.find((o) => !isOfferType(o));
  if (badOffer) die(`unknown offer "${badOffer}" (ai-roleplay, human-coaching)`);
  const name = opt("name") ?? `${FIXTURES[card].company.replace(/^TEST - /, "")} - ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const ownerId = await resolveOwnerId();

  if (dry) {
    console.log(`[dry] would ensure test contact ${FIXTURES[card].email} and company "${FIXTURES[card].company}", then create:`);
    console.log(`      "TEST - ${name}" in Prospection / R1 scheduled, owner ${ownerId}, Source "${source}", offer ${offers.join(";") || "-"}, sale_type direct, forced_move false`);
    return;
  }
  const { contactId, companyId, created } = await ensureTestFixture(card, ownerId, ACTOR);
  for (const c of created) console.log(`  + test ${c} created`);
  const res = await createProspectionDeal({
    dealName: name,
    ownerId,
    origin: source,
    offerTypes: offers,
    contactId,
    companyId,
    isTest: true,
    triggeredBy: "test_script",
    actor: ACTOR,
  });
  if (!res.ok) return printRefusal(res);
  console.log(`✔ created ${res.dealId}: ${res.dealName}\n  next: move --deal ${res.dealId}`);
}

async function cmdMove() {
  const dealId = opt("deal") ?? die("--deal is required");
  if (dry) {
    const d = await readGuardDeal(dealId);
    return console.log(`[dry] ${d.dealname}: pipeline ${d.pipeline}, stage ${d.dealstage}, TEST card: ${isTestDealName(d.dealname)}`);
  }
  const res = await moveR1ToScoping({ dealId, via: "test_script", actor: ACTOR });
  if (!res.ok) return printRefusal(res);
  console.log(`✔ ${res.dealName} moved to Scoping (SQL)\n  next: score --deal ${dealId} --value 82`);
}

async function cmdScore() {
  const dealId = opt("deal") ?? die("--deal is required");
  const value = Number(opt("value"));
  if (!Number.isFinite(value)) die("--value N is required");
  if (dry) {
    const d = await readGuardDeal(dealId);
    return console.log(`[dry] ${d.dealname}: would write ${Math.round(value)} (${scoreBand(Math.round(value))}), current ${d.scoreMedicKuna ?? "-"}`);
  }
  const res = await writeQualificationScore({ dealId, score: value, via: "test_script", actor: ACTOR, matchSure: true });
  if (!res.ok) return printRefusal(res);
  await recordScoreHistory({ dealId, score: res.score, scoreModel: "forced", triggeredBy: "test_script", hubspotWritten: true });
  const e = res.enrollment;
  console.log(`✔ ${res.dealName}: score ${res.previous ?? "-"} -> ${res.score} (${res.band})`);
  console.log(
    e.enrollable
      ? "  HubSpot workflow 01 should move the card (if it is turned on). Check with: status"
      : `  HubSpot will NOT move this card: ${ENROLLMENT_REASON_LABELS[e.reason]}`,
  );
}


async function testUser(): Promise<{ id: string; email: string; hubspot_owner_id: string }> {
  const { data, error } = await db
    .from("users")
    .select("id, email, hubspot_owner_id")
    .eq("is_admin", true)
    .ilike("name", "%arthur%")
    .not("hubspot_owner_id", "is", null);
  if (error) die(`users lookup failed: ${error.message}`);
  if ((data ?? []).length !== 1) die("cannot pick the test user automatically");
  return data![0] as { id: string; email: string; hubspot_owner_id: string };
}

async function cmdMeeting() {
  const card = (opt("card") ?? "a") as FixtureKey;
  if (!(card in FIXTURES)) die("--card must be a or b");
  const unsure = flag("unsure");
  const score = opt("score") !== undefined ? Number(opt("score")) : 65;
  const kind = opt("kind") ?? "discovery_r1";
  const me = await testUser();
  const fixture = FIXTURES[card];
  const recordingId = `${TEST_RECORDING_PREFIX}${Date.now()}`;
  const title = opt("title") ?? `TEST meeting with ${fixture.company.replace(/^TEST - /, "")}`;

  // Cas sûr : le participant est le contact de test, présent au meeting. Cas incertain :
  // participant inconnu de HubSpot, présence non prouvée, carte imposée par --deal.
  const participantEmail = unsure ? `unknown-${Date.now()}@example.net` : fixture.email;
  let dealId = opt("deal") ?? null;
  let method: string | null = dealId ? "participant_email" : null;
  let detail: Record<string, unknown> = {};
  if (unsure) {
    if (!dealId) die("--unsure needs --deal ID (the card the meeting is wrongly matched to)");
    method = "company_domain";
  } else if (!dealId) {
    const m = await resolveMeetingCard({ claapDealId: null, participantEmails: [participantEmail, me.email], recorderEmail: me.email, titleHint: null, meetingTitle: title, recordingId });
    if (!m.dealId) die(`no open TEST card found for ${participantEmail} (create one with: create --card ${card})`);
    dealId = m.dealId;
    method = m.method;
    detail = m.detail;
    console.log(`  matched card ${dealId} by ${method}`);
  }

  // Garde-fou : un meeting de test n'écrit jamais rien sur une vraie carte.
  const target = await readGuardDeal(dealId as string);
  if (!isTestDealName(target.dealname)) die(`${target.dealname} is not a TEST card: test meetings only act on cards named "TEST - ..."`);

  if (dry) return console.log(`[dry] would insert ${recordingId} on deal ${dealId} (method ${method}, attended ${!unsure}, score ${score}) and run the card flow`);

  // Score du deal simulé, passé au parcours comme le fait l'analyse réelle : le
  // parcours le range (rapprochement sûr) ou le garde en attente de confirmation.
  const scoreResult: ScoreOneDealResult | null = Number.isFinite(score)
    ? {
        total: Math.round(score),
        components: [],
        reliability: 0,
        reasoning: "TEST: call score simulated by scripts/test-switch.mts",
        next_action: "",
        next_move: null,
        qualification: {},
        key_events: [],
        kuna: null,
        committee: null,
        go_live_date: null,
      }
    : null;

  const { data: row, error } = await db
    .from("sales_coach_analyses")
    .insert({
      claap_recording_id: recordingId,
      recorder_email: me.email,
      user_id: me.id,
      hubspot_deal_id: dealId,
      meeting_title: title,
      meeting_started_at: new Date().toISOString(),
      meeting_type: "external",
      meeting_kind: kind,
      audience: "prospect",
      participants: [{ name: unsure ? "Unknown guest" : `${fixture.firstName} ${fixture.lastName}`, email: participantEmail, attended: unsure ? null : true }],
      internal_emails: [me.email.toLowerCase()],
      status: "done",
      deal_match_method: method,
      deal_match_detail: detail,
    })
    .select("id")
    .single();
  if (error || !row) die(`test meeting not saved: ${error?.message}`);
  console.log(`  test meeting ${row.id} (${recordingId}) saved`);
  const res = await runCardFlowAfterAnalysis(row.id as string, scoreResult);
  console.log(`✔ card flow: ${res.status}${res.detail ? ` (${res.detail})` : ""}${res.reasons?.length ? ` | not sure because: ${res.reasons.join(", ")}` : ""}`);
  if (res.status === "confirmation_requested")
    console.log(`  A DM asks for confirmation: add a ✅ or ❌ in Slack, then run: confirm --deal ${dealId} (the deployed app does it on its own). Or use the button on the meeting page.`);
  console.log(`  meeting page: /sales-coach?id=${row.id}`);
}

/**
 * Réponse à une demande de confirmation, comme si Slack avait appelé l'app
 * déployée : la réaction est lue sur le message (reactions.get), puis passée à
 * processCardConfirmation, le code de netlify/functions/slack-confirm-background.
 */
async function cmdConfirm() {
  const dealId = opt("deal") ?? die("--deal is required");
  const forced = flag("yes") ? "yes" : flag("no") ? "no" : null;
  const { data, error } = await db
    .from("slack_confirmations")
    .select("id, kind, slack_channel, slack_ts, slack_user_id, mode, created_at")
    .eq("deal_id", dealId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) die(`slack_confirmations: ${error.message}`);
  if (!data?.length) die("no pending confirmation request for this card");
  for (const row of data as { id: string; kind: string; slack_channel: string; slack_ts: string; slack_user_id: string; mode: string }[]) {
    let answer: "yes" | "no" | null = forced;
    if (!answer) {
      const url = `https://slack.com/api/reactions.get?channel=${encodeURIComponent(row.slack_channel)}&timestamp=${encodeURIComponent(row.slack_ts)}&full=true`;
      const r = (await fetch(url, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }).then((x) => x.json())) as {
        ok: boolean;
        error?: string;
        message?: { reactions?: { name: string; users?: string[] }[] };
      };
      if (!r.ok) die(`Slack reactions.get: ${r.error}`);
      for (const re of r.message?.reactions ?? []) {
        const a = parseConfirmationAnswer(re.name);
        if (a && (re.users ?? []).includes(row.slack_user_id)) {
          answer = a;
          break;
        }
      }
      if (!answer) {
        console.log(`  no ✅ / ❌ from the recipient yet on the ${row.kind} message. Add one in Slack and run again (or pass --yes / --no).`);
        continue;
      }
      console.log(`  reaction found on the ${row.kind} message: ${answer === "yes" ? "✅" : "❌"}`);
    }
    const res = await processCardConfirmation({ answer, channel: row.slack_channel, ts: row.slack_ts, slackUserId: row.slack_user_id });
    console.log(`${res.ok ? "✔" : "✖"} ${row.kind} (${row.mode}) answered ${answer}: ${res.message}`);
  }
}

async function cmdRefuse() {
  const dealId = opt("deal") ?? die("--deal is required (a REAL card: nothing is written, the guard must refuse)");
  const d = await readGuardDeal(dealId);
  if (isTestDealName(d.dealname)) die("this is a TEST card: pass a real card to check the refusal");
  const move = await moveR1ToScoping({ dealId, via: "test_script", actor: ACTOR });
  const score = await writeQualificationScore({ dealId, score: 50, via: "test_script", actor: ACTOR, matchSure: true });
  const okRefused = !move.ok && !score.ok;
  console.log(`${okRefused ? "✔" : "✖"} ${d.dealname}: move -> ${move.ok ? "WRITTEN (bug!)" : move.reason}, score -> ${score.ok ? "WRITTEN (bug!)" : score.reason}`);
}

async function cmdCleanup() {
  const deals = (await readDeals(await testDealIds())).filter((d) => isTestDealName(d.properties.dealname));
  console.log(`TEST cards still in HubSpot: ${deals.length}`);
  for (const d of deals) console.log(`  ${d.id}  ${d.properties.dealname}`);
  const ids = deals.map((d) => d.id);
  if (ids.length) {
    await db.from("deal_scores").delete().in("deal_id", ids);
    await db.from("deal_score_history").delete().in("deal_id", ids);
  }
  const { count } = await db.from("sales_coach_analyses").delete({ count: "exact" }).like("claap_recording_id", "rec_test_%");
  console.log(`Supabase: test scores removed, ${count ?? 0} test meeting analyses removed.`);
  if (!flag("archive")) return console.log("Add --archive to archive these cards in HubSpot (or let Gaëlle delete them).");
  for (const d of deals) {
    const log = await openWrite({ action: "archive_deal", objectType: "deals", objectId: d.id, triggeredBy: "test_script", actor: ACTOR, isTest: true });
    if (log.duplicate) continue;
    try {
      await hubspotArchive("deals", d.id);
      await closeWrite(log.id, { status: "done" });
      console.log(`  archived ${d.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await closeWrite(log.id, { status: "failed", error: msg });
      console.log(`  ✖ ${d.id}: ${msg}`);
    }
  }
}

async function cmdSet() {
  const [key, value] = [argv[1], argv[2]];
  if (!key || !value || !isCutoverKey(key)) die(`usage: set KEY VALUE. Keys: ${Object.keys(CUTOVER_SETTINGS).join(", ")}`);
  const state = await setCutoverSetting(key, value, ACTOR, { force: flag("force") });
  console.log(`✔ ${key} = ${state.values[key]}`);
}

async function cmdCutoverAt() {
  const v = argv[1];
  if (!v) die("usage: cutover-at ISO|none");
  const state = await setCutoverInstant(v === "none" ? null : v, ACTOR);
  console.log(`✔ cutover instant = ${state.cutoverAt ?? "not set"}`);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  status: cmdStatus,
  model: cmdModel,
  log: () => cmdLog(),
  create: cmdCreate,
  move: cmdMove,
  score: cmdScore,
  meeting: cmdMeeting,
  confirm: cmdConfirm,
  refuse: cmdRefuse,
  cleanup: cmdCleanup,
  set: cmdSet,
  "cutover-at": cmdCutoverAt,
};

const run = COMMANDS[command];
if (!run) die(`unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(", ")}`);
run()
  .then(() => process.exit(0))
  .catch((e) => die(e instanceof Error ? e.message : String(e)));
