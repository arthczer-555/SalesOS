// Écritures automatiques sur les deals HubSpot (bascule du 30/11/2026).
//
// SEUL point d'écriture autorisé pour : créer une carte du pipeline
// Prospection, la passer de R1 scheduled à Scoping (SQL), écrire le score
// (score_medic_kuna) et l'offre (type_offre). Règles de Gaëlle respectées ici :
// jamais d'autre changement d'étape, jamais de clôture, jamais de lifecycle.
//
// Chaque fonction : lit ses réglages (échec = aucune écriture), relit le deal
// dans HubSpot, vérifie ses garde-fous, ouvre une ligne de journal, écrit,
// ferme la ligne. Un refus n'est jamais une exception : { ok: false, reason }.

import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import {
  PIPELINE_IDS,
  STAGE_IDS,
  TEST_DEAL_PREFIX,
  isClosedStage,
  isEnrollableByScoreWorkflow,
  isProspectionPipeline,
  isSalesMotionPipeline,
  isTestDealName,
  scoreBand,
  type EnrollmentCheck,
  type ScoreBand,
} from "./pipeline-model";
import { gateByMode, loadCutoverState, type CutoverState } from "./cutover";
import { closeWrite, listWrites, openWrite, wasMovedToScopingBySalesOS, WriteLogUnavailableError, type WriteTrigger } from "./write-log";
import { isDealOrigin, isOfferType, offerTypesToHubspot, originNeedsPartner, type OfferType } from "@/lib/leads/origin";

export type RefusalReason =
  | "settings_unavailable"
  | "journal_unavailable"
  | "setting_off"
  | "test_mode_non_test_deal"
  | "creation_not_enabled"
  | "invalid_input"
  | "invalid_origin"
  | "partner_required"
  | "deal_unreadable"
  | "closed"
  | "not_prospection"
  | "not_sales_motion"
  | "not_r1_scheduled"
  | "still_r1_scheduled"
  | "match_not_sure"
  | "no_cutover_instant"
  | "not_new_card"
  | "same_value"
  | "already_set"
  | "duplicate"
  | "hubspot_error";

/** Libellés des refus (anglais : ils peuvent apparaître dans l'app et sur Slack). */
export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  settings_unavailable: "Settings could not be read, nothing was written",
  journal_unavailable: "Write log unavailable (migration not applied?), nothing was written",
  setting_off: "Turned off in the settings",
  test_mode_non_test_deal: "Test mode: only cards named \"TEST - ...\" are written",
  creation_not_enabled: "Creation in the Prospection pipeline is not enabled yet",
  invalid_input: "Invalid input",
  invalid_origin: "Source is missing or not an allowed value",
  partner_required: "Referring partner is required for this Source",
  deal_unreadable: "The deal could not be read in HubSpot",
  closed: "The card is closed",
  not_prospection: "The card is not in the Prospection pipeline",
  not_sales_motion: "The card is not in the Prospection or Sales pipeline",
  not_r1_scheduled: "The card is no longer in R1 scheduled",
  still_r1_scheduled: "The card is still in R1 scheduled",
  match_not_sure: "The meeting is not surely matched to this card",
  no_cutover_instant: "The cutover instant is not set yet",
  not_new_card: "Card created before the cutover (migrated card): score kept in CoachelloHQ only",
  same_value: "Value unchanged",
  already_set: "Already filled in HubSpot",
  duplicate: "Already done or in progress",
  hubspot_error: "HubSpot returned an error",
};

export type Refusal = { ok: false; reason: RefusalReason; detail?: string };
export type WriteOk<T> = { ok: true; logId: string } & T;
export type GuardedResult<T = Record<string, never>> = WriteOk<T> | Refusal;

const refuse = (reason: RefusalReason, detail?: string): Refusal => ({ ok: false, reason, ...(detail ? { detail } : {}) });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadSettings(): Promise<CutoverState | Refusal> {
  try {
    return await loadCutoverState();
  } catch (e) {
    return refuse("settings_unavailable", errMsg(e));
  }
}

const isRefusal = (v: unknown): v is Refusal => !!v && typeof v === "object" && (v as Refusal).ok === false;

export interface GuardDeal {
  id: string;
  dealname: string;
  pipeline: string;
  dealstage: string;
  createdate: string | null;
  enteredStageAt: string | null;
  scoreMedicKuna: number | null;
  forcedMove: string | null;
  saleType: string | null;
  typeOffre: string | null;
  ownerId: string | null;
}

const GUARD_PROPS = [
  "dealname",
  "pipeline",
  "dealstage",
  "createdate",
  "hs_v2_date_entered_current_stage",
  "score_medic_kuna",
  "forced_move",
  "sale_type",
  "type_offre",
  "hubspot_owner_id",
];

/** Relit le deal dans HubSpot (état à l'instant, jamais un instantané en base). */
export async function readGuardDeal(dealId: string): Promise<GuardDeal> {
  const res = await hubspotFetch<{ id: string; properties?: Record<string, string | null> }>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${GUARD_PROPS.join(",")}`,
  );
  const p = res.properties ?? {};
  const score = p.score_medic_kuna !== null && p.score_medic_kuna !== undefined && p.score_medic_kuna !== "" ? Number(p.score_medic_kuna) : null;
  return {
    id: String(res.id),
    dealname: p.dealname ?? "",
    pipeline: p.pipeline ?? "",
    dealstage: p.dealstage ?? "",
    createdate: p.createdate ?? null,
    enteredStageAt: p.hs_v2_date_entered_current_stage ?? null,
    scoreMedicKuna: score !== null && Number.isFinite(score) ? score : null,
    forcedMove: p.forced_move ?? null,
    saleType: p.sale_type ?? null,
    typeOffre: p.type_offre ?? null,
    ownerId: p.hubspot_owner_id ?? null,
  };
}

async function readDealOrRefuse(dealId: string): Promise<GuardDeal | Refusal> {
  try {
    return await readGuardDeal(dealId);
  } catch (e) {
    return refuse("deal_unreadable", errMsg(e));
  }
}

async function open(input: Parameters<typeof openWrite>[0]): Promise<{ id: string } | Refusal> {
  try {
    const r = await openWrite(input);
    if (r.duplicate) return refuse("duplicate");
    return { id: r.id };
  } catch (e) {
    return refuse(e instanceof WriteLogUnavailableError ? "journal_unavailable" : "journal_unavailable", errMsg(e));
  }
}

// ── 1. Création d'une carte Prospection / R1 scheduled ──────────────────────

export interface CreateProspectionDealInput {
  dealName: string;
  ownerId: string;
  origin: string;
  offerTypes?: readonly string[];
  referringPartner?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  /** Carte de test : nom préfixé "TEST - ", autorisée quel que soit le réglage de création. */
  isTest: boolean;
  triggeredBy: WriteTrigger;
  actor: string | null;
  leadId?: string | null;
}

// Types d'association HUBSPOT_DEFINED : deal -> contact = 3, deal -> company (primaire) = 5.
const ASSOC_DEAL_TO_CONTACT = 3;
const ASSOC_DEAL_TO_PRIMARY_COMPANY = 5;
const RECENT_DUPLICATE_MS = 10 * 60 * 1000;

export async function createProspectionDeal(
  input: CreateProspectionDealInput,
): Promise<GuardedResult<{ dealId: string; dealName: string; reused: boolean }>> {
  const ownerId = input.ownerId?.trim();
  if (!ownerId) return refuse("invalid_input", "ownerId is required");
  if (!isDealOrigin(input.origin)) return refuse("invalid_origin", `"${input.origin}"`);
  const partner = input.referringPartner?.trim() || null;
  if (originNeedsPartner(input.origin) && !partner) return refuse("partner_required");
  const offers = [...new Set((input.offerTypes ?? []).filter(isOfferType))] as OfferType[];

  let dealName = input.dealName.trim();
  if (!dealName) return refuse("invalid_input", "deal name is required");
  if (input.isTest && !isTestDealName(dealName)) dealName = `${TEST_DEAL_PREFIX}${dealName}`;
  if (!input.isTest && isTestDealName(dealName)) return refuse("invalid_input", "a real card cannot be named \"TEST - ...\"");

  const settings = await loadSettings();
  if (isRefusal(settings)) return settings;
  if (!input.isTest && settings.values.hubspot_creation !== "prospection") {
    return refuse("creation_not_enabled", `hubspot_creation = ${settings.values.hubspot_creation}`);
  }

  // Idempotence d'un nouvel essai (504 côté navigateur puis nouveau clic) :
  // une création du même lead dans les 10 dernières minutes est réutilisée.
  if (input.leadId) {
    try {
      const since = new Date(Date.now() - RECENT_DUPLICATE_MS).toISOString();
      const recent = await listWrites({ action: "create_deal", leadId: input.leadId, sinceIso: since, limit: 5 });
      const same = recent.filter((r) => r.is_test === input.isTest);
      const done = same.find((r) => r.status === "done" && r.object_id);
      if (done) return { ok: true, logId: done.id, dealId: done.object_id as string, dealName, reused: true };
      if (same.some((r) => r.status === "pending")) return refuse("duplicate", "a creation for this lead is in progress");
    } catch (e) {
      return refuse("journal_unavailable", errMsg(e));
    }
  }

  const properties: Record<string, string> = {
    dealname: dealName,
    hubspot_owner_id: ownerId,
    pipeline: PIPELINE_IDS.prospection,
    dealstage: STAGE_IDS.r1Scheduled,
    origin: input.origin,
    // Le workflow [PIPE] 01 n'enrôle pas une carte où ces deux champs sont vides.
    sale_type: "direct",
    forced_move: "false",
  };
  if (offers.length) properties.type_offre = offerTypesToHubspot(offers);
  if (partner) properties.referring_partner = partner;

  const associations: { to: { id: string }; types: { associationCategory: "HUBSPOT_DEFINED"; associationTypeId: number }[] }[] = [];
  if (input.contactId) associations.push({ to: { id: input.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_DEAL_TO_CONTACT }] });
  if (input.companyId) associations.push({ to: { id: input.companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_DEAL_TO_PRIMARY_COMPANY }] });

  const log = await open({
    action: "create_deal",
    objectType: "deals",
    triggeredBy: input.triggeredBy,
    actor: input.actor,
    mode: input.isTest ? "test" : settings.values.hubspot_creation,
    isTest: input.isTest,
    after: { properties, contactId: input.contactId ?? null, companyId: input.companyId ?? null },
    leadId: input.leadId ?? null,
  });
  if (isRefusal(log)) return log;

  try {
    const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/deals", "POST", { properties, associations });
    const dealId = String(res.id);
    await closeWrite(log.id, { status: "done", objectId: dealId });
    return { ok: true, logId: log.id, dealId, dealName, reused: false };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}

// ── 2. Passage R1 scheduled -> Scoping (SQL) ────────────────────────────────

export interface MoveR1Input {
  dealId: string;
  /** automatic = rapprochement sûr ; confirmation = réponse humaine ; test_script = cartes TEST seulement. */
  via: "automatic" | "confirmation" | "test_script";
  actor: string | null;
  analysisId?: string | null;
  matchMethod?: string | null;
}

/**
 * La SEULE écriture de dealstage sur un deal existant. Toujours vers l'avant,
 * une seule fois : relit le deal, exige le pipeline Prospection ET l'étape R1
 * scheduled, réserve la clé (deal + date d'entrée dans l'étape) avant d'écrire.
 */
export async function moveR1ToScoping(input: MoveR1Input): Promise<GuardedResult<{ dealName: string }>> {
  const settings = await loadSettings();
  if (isRefusal(settings)) return settings;
  const mode =
    input.via === "test_script" ? "test" : input.via === "confirmation" ? settings.values.r1_confirm_move : settings.values.hubspot_r1_move;

  const deal = await readDealOrRefuse(input.dealId);
  if (isRefusal(deal)) return deal;
  if (isClosedStage(deal.dealstage)) return refuse("closed");
  if (!isProspectionPipeline(deal.pipeline)) return refuse("not_prospection");
  if (deal.dealstage !== STAGE_IDS.r1Scheduled) return refuse("not_r1_scheduled");
  const gate = gateByMode(mode, deal.dealname);
  if (!gate.allowed) return refuse(gate.reason, `mode = ${mode}`);

  const log = await open({
    action: "r1_to_scoping",
    objectType: "deals",
    objectId: deal.id,
    dedupeKey: `r1_to_scoping:${deal.id}:${deal.enteredStageAt ?? "unknown"}`,
    triggeredBy: input.via === "automatic" ? "claap_call" : input.via === "confirmation" ? "confirmation" : "test_script",
    actor: input.actor,
    mode,
    isTest: isTestDealName(deal.dealname),
    before: { dealstage: deal.dealstage },
    after: { dealstage: STAGE_IDS.scoping, matchMethod: input.matchMethod ?? null },
    analysisId: input.analysisId ?? null,
  });
  if (isRefusal(log)) return log;

  try {
    await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(deal.id)}`, "PATCH", { properties: { dealstage: STAGE_IDS.scoping } });
    await closeWrite(log.id, { status: "done" });
    return { ok: true, logId: log.id, dealName: deal.dealname };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}

// ── 3. Score de qualification (score_medic_kuna) ────────────────────────────

export interface ScoreWriteInput {
  dealId: string;
  score: number;
  via: "claap_call" | "confirmation" | "test_script";
  actor: string | null;
  analysisId?: string | null;
  /** Le meeting est-il sûrement (ou humainement) rattaché à cette carte ? Sinon : rien n'est écrit. */
  matchSure: boolean;
}

export interface ScoreWriteOk {
  score: number;
  previous: number | null;
  band: ScoreBand;
  enrollment: EnrollmentCheck;
  dealName: string;
}

/**
 * Écrit le score dans HubSpot. Garde-fous : rapprochement sûr, carte ouverte
 * des pipelines Prospection ou Sales, plus en R1 scheduled (le score part
 * juste après le passage en Scoping), réglage hubspot_score_write respecté
 * (on_new : cartes créées après l'instant de bascule, ou passées en Scoping
 * par le SalesOS ; les cartes migrées gardent leur score dans CoachelloHQ).
 */
export async function writeQualificationScore(input: ScoreWriteInput): Promise<GuardedResult<ScoreWriteOk>> {
  if (!Number.isFinite(input.score)) return refuse("invalid_input", "score is not a number");
  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  if (!input.matchSure) return refuse("match_not_sure");

  const settings = await loadSettings();
  if (isRefusal(settings)) return settings;
  const mode = input.via === "test_script" ? "test" : settings.values.hubspot_score_write;

  const deal = await readDealOrRefuse(input.dealId);
  if (isRefusal(deal)) return deal;
  if (isClosedStage(deal.dealstage)) return refuse("closed");
  if (!isSalesMotionPipeline(deal.pipeline)) return refuse("not_sales_motion");
  if (deal.dealstage === STAGE_IDS.r1Scheduled) return refuse("still_r1_scheduled");

  if (mode === "on_new") {
    if (!isTestDealName(deal.dealname)) {
      if (!settings.cutoverAt) return refuse("no_cutover_instant");
      const created = deal.createdate ? Date.parse(deal.createdate) : NaN;
      const isNew = Number.isFinite(created) && created >= Date.parse(settings.cutoverAt);
      if (!isNew) {
        let moved = false;
        try {
          moved = await wasMovedToScopingBySalesOS(deal.id);
        } catch (e) {
          return refuse("journal_unavailable", errMsg(e));
        }
        if (!moved) return refuse("not_new_card");
      }
    }
  } else {
    const gate = gateByMode(mode, deal.dealname);
    if (!gate.allowed) return refuse(gate.reason, `mode = ${mode}`);
  }

  if (deal.scoreMedicKuna === score) return refuse("same_value");

  const log = await open({
    action: "score",
    objectType: "deals",
    objectId: deal.id,
    dedupeKey: input.analysisId ? `score:${deal.id}:${input.analysisId}` : null,
    triggeredBy: input.via,
    actor: input.actor,
    mode,
    isTest: isTestDealName(deal.dealname),
    before: { score_medic_kuna: deal.scoreMedicKuna },
    after: { score_medic_kuna: score },
    analysisId: input.analysisId ?? null,
  });
  if (isRefusal(log)) return log;

  try {
    await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(deal.id)}`, "PATCH", { properties: { score_medic_kuna: String(score) } });
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    await db.from("deal_scores").update({ hubspot_sync_error: errMsg(e).slice(0, 500) }).eq("deal_id", deal.id).then(() => null, () => null);
    return refuse("hubspot_error", errMsg(e));
  }
  await closeWrite(log.id, { status: "done" });
  // Best-effort : la ligne deal_scores n'existe pas forcément (carte jamais scorée en base).
  await db
    .from("deal_scores")
    .update({ hubspot_score: score, hubspot_synced_at: new Date().toISOString(), hubspot_sync_error: null })
    .eq("deal_id", deal.id)
    .then(() => null, () => null);

  return {
    ok: true,
    logId: log.id,
    score,
    previous: deal.scoreMedicKuna,
    band: scoreBand(score),
    enrollment: isEnrollableByScoreWorkflow({ pipeline: deal.pipeline, dealstage: deal.dealstage, forced_move: deal.forcedMove, sale_type: deal.saleType }),
    dealName: deal.dealname,
  };
}

// ── 4. Offre (type_offre), seulement si vide ────────────────────────────────

export interface TypeOffreWriteInput {
  dealId: string;
  offerTypes: readonly string[];
  via: "claap_call" | "confirmation" | "test_script";
  actor: string | null;
  analysisId?: string | null;
  matchSure: boolean;
}

export async function writeTypeOffre(input: TypeOffreWriteInput): Promise<GuardedResult<{ value: string }>> {
  const offers = [...new Set(input.offerTypes.filter(isOfferType))] as OfferType[];
  if (!offers.length) return refuse("invalid_input", "no valid offer type");
  if (!input.matchSure) return refuse("match_not_sure");

  const settings = await loadSettings();
  if (isRefusal(settings)) return settings;
  const mode = input.via === "test_script" ? "test" : settings.values.type_offre_write;

  const deal = await readDealOrRefuse(input.dealId);
  if (isRefusal(deal)) return deal;
  if (isClosedStage(deal.dealstage)) return refuse("closed");
  if (!isSalesMotionPipeline(deal.pipeline)) return refuse("not_sales_motion");
  if ((deal.typeOffre ?? "").trim()) return refuse("already_set");
  const gate = gateByMode(mode, deal.dealname);
  if (!gate.allowed) return refuse(gate.reason, `mode = ${mode}`);

  const value = offerTypesToHubspot(offers);
  const log = await open({
    action: "type_offre",
    objectType: "deals",
    objectId: deal.id,
    dedupeKey: `type_offre:${deal.id}`,
    triggeredBy: input.via,
    actor: input.actor,
    mode,
    isTest: isTestDealName(deal.dealname),
    before: { type_offre: deal.typeOffre },
    after: { type_offre: value },
    analysisId: input.analysisId ?? null,
  });
  if (isRefusal(log)) return log;
  try {
    await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(deal.id)}`, "PATCH", { properties: { type_offre: value } });
    await closeWrite(log.id, { status: "done" });
    return { ok: true, logId: log.id, value };
  } catch (e) {
    await closeWrite(log.id, { status: "failed", error: errMsg(e) });
    return refuse("hubspot_error", errMsg(e));
  }
}

// ── Historique des scores (CoachelloHQ) ─────────────────────────────────────

export async function recordScoreHistory(entry: {
  dealId: string;
  score: number;
  scoreModel: string;
  triggeredBy: string;
  analysisId?: string | null;
  hubspotWritten: boolean;
  detail?: unknown;
}): Promise<void> {
  const score = Math.round(entry.score);
  const { error } = await db.from("deal_score_history").insert({
    deal_id: entry.dealId,
    score,
    band: scoreBand(score),
    score_model: entry.scoreModel,
    triggered_by: entry.triggeredBy,
    analysis_id: entry.analysisId ?? null,
    hubspot_written: entry.hubspotWritten,
    detail: entry.detail ?? null,
  });
  if (error) console.warn("[deal-writes] deal_score_history insert failed:", error.message);
}
