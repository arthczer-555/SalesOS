// Après l'analyse d'un meeting de vente : passage R1 scheduled -> Scoping (SQL),
// écriture du score dans HubSpot, ou demande de confirmation (plan, 5.2 et 5.3).
//
//  - rapprochement sûr : la carte passe en Scoping si elle est en R1
//    scheduled, puis le score est écrit ; le owner reçoit un DM ;
//  - sinon : demande de confirmation aux Coachello présents au meeting (✅ / ❌
//    sur le DM, ou bouton dans la fiche Sales Coach). Rien n'est écrit avant.
// Toutes les écritures passent par lib/hubspot/deal-writes.ts (réglages,
// garde-fous, journal). Un rejeu de test (rec_test_...) ne touche que les
// cartes "TEST - " ; un vrai meeting ne les touche jamais.

import { db } from "@/lib/db";
import { gateByMode, loadCutoverState } from "@/lib/hubspot/cutover";
import {
  REFUSAL_LABELS,
  moveR1ToScoping,
  readGuardDeal,
  recordScoreHistory,
  writeQualificationScore,
  type GuardDeal,
  type GuardedResult,
  type ScoreWriteOk,
} from "@/lib/hubspot/deal-writes";
import {
  ENROLLMENT_REASON_LABELS,
  SCORE_BAND_LABELS,
  STAGE_IDS,
  isClosedStage,
  isSalesMotionPipeline,
  isTestDealName,
  scoreBand,
} from "@/lib/hubspot/pipeline-model";
import { getScoreWorkflowState, type ScoreWorkflowState } from "@/lib/hubspot/score-workflow";
import { hubspotDealUrl } from "@/lib/leads/finalize";
import {
  claimConfirmation,
  closeRequest,
  createConfirmationRequest,
  findConfirmationByMessage,
  getConfirmation,
  latestPendingForAnalysis,
  supersedePendingForAnalysis,
  type ConfirmationRow,
} from "@/lib/slack/confirmations";
import { dmRecipient, lookupSlackIdByEmail } from "@/lib/slack/lookup";
import { persistDealScore, type ScoreOneDealResult } from "@/lib/deal-scoring";
import { SURE_REASON_LABELS, evaluateSureMatch, isTestRecording, type SureReason } from "./deal-match";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
const analysisLink = (id: string) => (appUrl() ? `${appUrl()}/sales-coach?id=${id}` : null);
const dealLink = (deal: { id: string; dealname: string }) => {
  const url = hubspotDealUrl(deal.id);
  return url ? `<${url}|${deal.dealname}>` : deal.dealname;
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface AnalysisRow {
  id: string;
  claap_recording_id: string;
  hubspot_deal_id: string | null;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  recorder_email: string | null;
  participants: { name?: string | null; email?: string | null; attended?: boolean | null }[] | null;
  internal_emails: string[] | null;
  deal_match_method?: string | null;
  presence_verdict?: string | null;
}

async function loadAnalysis(id: string): Promise<AnalysisRow | null> {
  const base = "id, claap_recording_id, hubspot_deal_id, meeting_title, meeting_started_at, meeting_kind, audience, recorder_email, participants, internal_emails";
  const withNew = await db.from("sales_coach_analyses").select(`${base}, deal_match_method, presence_verdict`).eq("id", id).maybeSingle();
  if (!withNew.error) return (withNew.data as AnalysisRow | null) ?? null;
  // Colonnes de la migration du 30/11 absentes : lecture sans elles.
  const plain = await db.from("sales_coach_analyses").select(base).eq("id", id).maybeSingle();
  return (plain.data as AnalysisRow | null) ?? null;
}

/** Écriture tolérante des colonnes de suivi (migration du 30/11). */
async function patchAnalysis(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("sales_coach_analyses").update(patch).eq("id", id);
  if (error) console.warn(`[card-flow] analysis ${id} tracking not saved:`, error.message);
}

function meetingLine(row: AnalysisRow): string {
  const date = row.meeting_started_at ? new Date(row.meeting_started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  const externals = (row.participants ?? []).map((p) => p.name || p.email).filter(Boolean).slice(0, 4).join(", ");
  return [`"${row.meeting_title ?? "Meeting"}"`, date, externals ? `with ${externals}` : null].filter(Boolean).join(" · ");
}

function stageName(deal: GuardDeal): string {
  if (deal.dealstage === STAGE_IDS.r1Scheduled) return "R1 scheduled";
  if (deal.dealstage === STAGE_IDS.scoping) return "Scoping (SQL)";
  return "its current stage";
}

/**
 * Phrase qui dit ce qu'il advient de la carte après l'écriture du score. Elle ne
 * promet un déplacement que si le workflow [PIPE] 01 de HubSpot est allumé.
 */
function scoreOutcomeLine(res: GuardedResult<ScoreWriteOk>, score: number | null, workflow: ScoreWorkflowState): string | null {
  if (score === null) return null;
  if (!res.ok) {
    if (res.reason === "same_value") return `Score unchanged (${score}).`;
    if (res.reason === "setting_off" || res.reason === "test_mode_non_test_deal") return null;
    return `Score ${score} not written to HubSpot: ${REFUSAL_LABELS[res.reason].toLowerCase()}.`;
  }
  const head = `Score: ${res.previous ?? "-"} → ${res.score} (${SCORE_BAND_LABELS[res.band]}).`;
  if (!res.enrollment.enrollable) return `${head} HubSpot will not move this card (${ENROLLMENT_REASON_LABELS[res.enrollment.reason]}).`;
  if (res.previous !== null && scoreBand(res.previous) === res.band) return `${head} Same band as before.`;
  const target = res.band === "qualified" ? "the Sales pipeline (Qualified opportunity)" : `Opportunity ${res.band}`;
  if (workflow === "off") return `${head} HubSpot's score workflow is turned off: the card does not move to ${target}.`;
  const verb = workflow === "on" ? "moves" : "should move";
  return `${head} ${res.band === "qualified" ? "Qualified: " : ""}HubSpot ${verb} the card to ${target}.`;
}

async function slackIdForOwner(hubspotOwnerId: string | null): Promise<string | null> {
  if (!hubspotOwnerId) return null;
  const { data } = await db.from("users").select("slack_user_id, email").eq("hubspot_owner_id", hubspotOwnerId).limit(1);
  const u = (data ?? [])[0] as { slack_user_id: string | null; email: string | null } | undefined;
  if (u?.slack_user_id) return u.slack_user_id;
  return u?.email ? lookupSlackIdByEmail(u.email) : null;
}

/** Coachello présents au meeting (destinataires de la demande), sinon la personne qui l'a enregistré. */
async function meetingRecipients(row: AnalysisRow): Promise<string[]> {
  const emails = [...new Set([...(row.internal_emails ?? []), row.recorder_email ?? ""].map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (!emails.length) return [];
  const { data } = await db.from("users").select("email, slack_user_id").in("email", emails);
  const known = new Map(((data ?? []) as { email: string; slack_user_id: string | null }[]).map((u) => [u.email.toLowerCase(), u.slack_user_id]));
  const ids: string[] = [];
  for (const email of emails) {
    const id = known.get(email) || (await lookupSlackIdByEmail(email));
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

export interface CardFlowResult {
  status: "no_deal" | "not_sales_motion" | "test_mismatch" | "sure" | "confirmation_requested" | "confirmation_skipped" | "error";
  detail?: string;
  moved?: boolean;
  scoreWritten?: boolean;
  reasons?: SureReason[];
}

/** Range le score du deal dans CoachelloHQ (deal_scores). Ne lève jamais. */
async function storeDealScore(dealId: string, result: ScoreOneDealResult | null): Promise<void> {
  if (!result) return;
  await persistDealScore(dealId, result, { trigger: "call" }).catch((e) => console.warn(`[card-flow] deal score ${dealId} not stored:`, errMsg(e)));
}

/**
 * Appelé par lib/sales-coach/run-analysis.ts quand l'analyse d'un meeting de
 * vente est terminée, avec le score du deal recalculé (pas encore rangé). Ne
 * lève jamais. Décision d'Arthur du 25/11 : rien n'est écrit sur le deal avant
 * une confirmation, ni dans HubSpot ni dans CoachelloHQ.
 *  - rapprochement sûr : score rangé, puis passage en Scoping et score HubSpot ;
 *  - incertain : le score calculé attend dans la demande de confirmation
 *    (proposed.scoreResult) et n'est rangé qu'au ✅ ; au ❌ rien à défaire ;
 *  - pas de demande possible (réglage qui ne l'autorise pas sur cette carte,
 *    personne à qui la poser, envoi en échec) : score rangé comme avant la
 *    bascule, sans écriture HubSpot.
 */
export async function runCardFlowAfterAnalysis(analysisId: string, scoreResult: ScoreOneDealResult | null): Promise<CardFlowResult> {
  let dealIdForFallback: string | null = null;
  let handled = false;
  try {
    const row = await loadAnalysis(analysisId);
    if (!row?.hubspot_deal_id) return { status: "no_deal" };
    dealIdForFallback = row.hubspot_deal_id;
    const deal = await readGuardDeal(row.hubspot_deal_id);
    if (!isSalesMotionPipeline(deal.pipeline) || isClosedStage(deal.dealstage)) {
      handled = true;
      await storeDealScore(deal.id, scoreResult);
      return { status: "not_sales_motion" };
    }
    // Un rejeu de test ne touche que les cartes TEST, un vrai meeting jamais.
    if (isTestRecording(row.claap_recording_id) !== isTestDealName(deal.dealname)) {
      handled = true;
      await storeDealScore(deal.id, scoreResult);
      return { status: "test_mismatch" };
    }

    const participants = row.participants ?? [];
    const externalEmails = participants.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean);
    const sure = await evaluateSureMatch({
      dealId: deal.id,
      method: row.deal_match_method ?? null,
      externalEmails,
      participants,
      presenceVerdict: row.presence_verdict ?? null,
      audience: row.audience,
      meetingKind: row.meeting_kind,
    });
    const scoreTotal = scoreResult?.total;
    const score = typeof scoreTotal === "number" && Number.isFinite(scoreTotal) ? Math.round(scoreTotal) : null;

    if (sure.sure) {
      // Rangé AVANT l'écriture HubSpot : writeQualificationScore marque la ligne
      // deal_scores comme synchronisée (hubspot_score), elle doit exister.
      handled = true;
      await storeDealScore(deal.id, scoreResult);
      const outcome = await applyMoveAndScore({ deal, row, score, via: "automatic", actor: "sales_coach" });
      await patchAnalysis(row.id, { stage_move_result: outcome.moveResult, ...(outcome.moved ? { stage_moved_at: new Date().toISOString() } : {}) });
      if (outcome.notify.length) {
        const owner = await slackIdForOwner(deal.ownerId);
        if (owner) await dmRecipient(owner, outcome.notify.join("\n")).catch((e) => console.warn("[card-flow] owner DM failed:", errMsg(e)));
      }
      return { status: "sure", moved: outcome.moved, scoreWritten: outcome.scoreWritten };
    }

    // ── Rapprochement incertain : demande de confirmation ──
    const settings = await loadCutoverState();
    const gate = gateByMode(settings.values.r1_confirm_move, deal.dealname);
    if (!gate.allowed) {
      handled = true;
      await storeDealScore(deal.id, scoreResult);
      await patchAnalysis(row.id, { stage_move_result: `not_sure:${sure.reasons.join(",")}` });
      return { status: "confirmation_skipped", detail: gate.reason, reasons: sure.reasons };
    }
    const kind = deal.dealstage === STAGE_IDS.r1Scheduled ? "r1_move" : "deal_link";
    const recipients = await meetingRecipients(row);
    if (!recipients.length) {
      handled = true;
      await storeDealScore(deal.id, scoreResult);
      await patchAnalysis(row.id, { stage_move_result: `not_sure:${sure.reasons.join(",")}` });
      return { status: "confirmation_skipped", detail: "no_recipient", reasons: sure.reasons };
    }
    // Une demande par meeting : une ré-analyse du même meeting remplace la précédente.
    await supersedePendingForAnalysis(row.id, ":information_source: This meeting was analyzed again: a new request replaces this one. Nothing was written.").catch(() => 0);

    const reactions = settings.values.slack_confirm_reaction === "on";
    const link = analysisLink(row.id);
    const question = kind === "r1_move" ? `*Was this the R1 for ${dealLink(deal)}?*` : `*Is this meeting about ${dealLink(deal)}?*`;
    const effect =
      kind === "r1_move"
        ? `the card moves to Scoping (SQL)${score !== null ? ` and its score (${score}) is written to HubSpot` : ""}`
        : score !== null
          ? `its score (${score}) is updated in HubSpot`
          : "the meeting stays linked to this card";
    const lines = [
      `:grey_question: ${question}`,
      `Meeting: ${meetingLine(row)}`,
      `Card: ${deal.dealname} (${stageName(deal)})`,
      `Not sure because ${sure.reasons.map((r) => SURE_REASON_LABELS[r]).join("; ")}.`,
      "Nothing is written to the deal until someone confirms.",
      reactions
        ? `Add a ✅ to this message to confirm: ${effect}. Add a ❌ if it is not this deal.`
        : `Confirm in CoachelloHQ: ${effect}.`,
      link ? `<${link}|Open the meeting in CoachelloHQ>` : null,
    ].filter(Boolean) as string[];

    const sent = await createConfirmationRequest({
      kind,
      requestKey: `${kind}:${deal.id}:${row.id}`,
      recipients: recipients.map((id) => ({ slackUserId: id })),
      mode: settings.values.r1_confirm_move === "on" ? "live" : "test",
      analysisId: row.id,
      dealId: deal.id,
      // scoreResult : le score calculé, rangé dans CoachelloHQ seulement au ✅.
      proposed: { score, dealName: deal.dealname, stage: deal.dealstage, scoreResult },
      text: lines.join("\n"),
    });
    handled = true;
    if (!sent.sent) {
      // Personne n'a reçu la question : on ne perd pas le score, il est rangé comme avant la bascule.
      await storeDealScore(deal.id, scoreResult);
      await patchAnalysis(row.id, { stage_move_result: `not_sure:${sure.reasons.join(",")}` });
      return { status: "confirmation_skipped", detail: sent.errors.join("; ") || "not_sent", reasons: sure.reasons };
    }
    await patchAnalysis(row.id, { stage_move_result: "awaiting_confirmation" });
    return { status: "confirmation_requested", detail: sent.errors.join("; ") || undefined, reasons: sure.reasons };
  } catch (e) {
    console.error(`[card-flow] ${analysisId} failed:`, errMsg(e));
    // Erreur avant toute décision (HubSpot illisible...) : le score n'est pas perdu.
    if (!handled && dealIdForFallback) await storeDealScore(dealIdForFallback, scoreResult);
    return { status: "error", detail: errMsg(e) };
  }
}

async function applyMoveAndScore(args: {
  deal: GuardDeal;
  row: AnalysisRow;
  score: number | null;
  via: "automatic" | "confirmation";
  actor: string | null;
}): Promise<{ moved: boolean; scoreWritten: boolean; moveResult: string; lines: string[]; notify: string[] }> {
  const { deal, row, score } = args;
  // lines : tout ce qui a été fait ou refusé (réponse à une confirmation).
  // notify : ce qui mérite un DM au owner (carte déplacée, changement de colonne).
  // Un refus attendu (carte migrée, réglage, même valeur) ne lui écrit jamais.
  const lines: string[] = [];
  const notify: string[] = [];
  let moved = false;
  let moveResult = "not_in_r1";
  if (deal.dealstage === STAGE_IDS.r1Scheduled) {
    const move = await moveR1ToScoping({ dealId: deal.id, via: args.via, actor: args.actor, analysisId: row.id, matchMethod: row.deal_match_method ?? null });
    moved = move.ok;
    moveResult = move.ok ? "moved" : `refused:${move.reason}`;
    if (move.ok) {
      const line = `:arrow_right: ${dealLink(deal)} moved to *Scoping (SQL)* after ${meetingLine(row)}.`;
      lines.push(line);
      notify.push(line);
    } else if (move.reason !== "setting_off" && move.reason !== "test_mode_non_test_deal") {
      lines.push(`:warning: ${dealLink(deal)} was not moved to Scoping (SQL): ${REFUSAL_LABELS[move.reason].toLowerCase()}.`);
      if (move.reason === "hubspot_error" || move.reason === "journal_unavailable") console.error(`[card-flow] move ${deal.id} failed:`, move.detail);
    }
  }
  let scoreWritten = false;
  if (score !== null) {
    const res = await writeQualificationScore({ dealId: deal.id, score, via: args.via === "automatic" ? "claap_call" : "confirmation", actor: args.actor, analysisId: row.id, matchSure: true });
    scoreWritten = res.ok;
    await recordScoreHistory({ dealId: deal.id, score, scoreModel: "v1", triggeredBy: args.via === "automatic" ? "claap_call" : "confirmation", analysisId: row.id, hubspotWritten: res.ok });
    if (!res.ok && (res.reason === "hubspot_error" || res.reason === "journal_unavailable")) console.error(`[card-flow] score ${deal.id} failed:`, res.detail);
    const line = scoreOutcomeLine(res, score, res.ok ? await getScoreWorkflowState() : "unknown");
    if (line) {
      const text = lines.length ? line : `${dealLink(deal)}: ${line}`;
      lines.push(text);
      const bandChanged = res.ok && (res.previous === null || scoreBand(res.previous) !== res.band);
      if (moved || bandChanged) notify.push(text);
    }
  }
  return { moved, scoreWritten, moveResult, lines, notify };
}

// ── Réponse à une demande (Slack ou bouton) ─────────────────────────────────

export interface ConfirmationAnswerInput {
  answer: "yes" | "no";
  /** Demande visée : par son message Slack, par son id, ou par l'analyse (bouton sans demande). */
  channel?: string;
  ts?: string;
  confirmationId?: string;
  analysisId?: string;
  /** Slack : seul le destinataire du message peut répondre. */
  slackUserId?: string;
  /** Application : l'appelant a déjà vérifié le droit d'éditer l'analyse. */
  appUser?: { id: string; email: string | null };
}

export interface ConfirmationAnswerResult {
  ok: boolean;
  message: string;
}

const doneText = (base: string, who: string) => `${base}\n_${who}_`;

export async function processCardConfirmation(input: ConfirmationAnswerInput): Promise<ConfirmationAnswerResult> {
  let row: ConfirmationRow | null = null;
  if (input.confirmationId) row = await getConfirmation(input.confirmationId);
  else if (input.channel && input.ts) row = await findConfirmationByMessage(input.channel, input.ts);
  else if (input.analysisId) row = await latestPendingForAnalysis(input.analysisId);

  const who = input.slackUserId ? `Answered by <@${input.slackUserId}>` : `Answered in CoachelloHQ by ${input.appUser?.email ?? "a user"}`;
  const actor = input.slackUserId ? `slack:${input.slackUserId}` : input.appUser?.email ?? input.appUser?.id ?? null;

  // Bouton sans demande en attente (aucun DM envoyé, ou demande expirée) : on agit directement.
  if (!row) {
    if (!input.analysisId || !input.appUser) return { ok: false, message: "Unknown or already answered request." };
    return answerWithoutRequest(input.analysisId, input.answer, actor);
  }
  if (input.slackUserId && row.slack_user_id !== input.slackUserId) return { ok: false, message: "Only the person who received this message can answer it." };
  if (row.status !== "pending") return { ok: false, message: `This request is already ${row.status}.` };
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    await closeRequest(row.request_key, "expired", { text: ":hourglass: This request expired: nothing was written. Confirm the card from the meeting in CoachelloHQ." });
    return { ok: false, message: "This request expired." };
  }
  if (!(await claimConfirmation(row.id))) return { ok: false, message: "This request is already being processed." };

  try {
    const analysis = row.analysis_id ? await loadAnalysis(row.analysis_id) : null;
    if (row.analysis_id && (!analysis || analysis.hubspot_deal_id !== row.deal_id)) {
      await closeRequest(row.request_key, "superseded", { text: ":information_source: This meeting is now linked to another card: nothing was written." });
      return { ok: false, message: "The meeting is now linked to another card." };
    }
    const dealName = (row.proposed?.dealName as string | undefined) ?? row.deal_id ?? "this card";
    if (input.answer === "no") {
      if (analysis) await patchAnalysis(analysis.id, { stage_move_result: "rejected_by_user" });
      const link = analysis ? analysisLink(analysis.id) : null;
      await closeRequest(row.request_key, "done", {
        answer: "no",
        answeredBy: actor,
        text: doneText(`:x: Noted: this meeting is not about ${dealName}. Nothing was written.${link ? ` <${link}|Change the deal in CoachelloHQ>` : ""}`, who),
      });
      return { ok: true, message: "Noted, nothing was written." };
    }

    if (!row.deal_id || !analysis) {
      await closeRequest(row.request_key, "failed", { text: ":warning: This request has no card attached: nothing was written." });
      return { ok: false, message: "No card attached to this request." };
    }
    const deal = await readGuardDeal(row.deal_id);
    if (row.mode === "test" && !isTestDealName(deal.dealname)) {
      await closeRequest(row.request_key, "done", { answer: "yes", answeredBy: actor, text: doneText(`:test_tube: Test: would move / score ${deal.dealname}. Nothing was written (test mode).`, who) });
      return { ok: true, message: "Test mode: nothing was written." };
    }
    await patchAnalysis(analysis.id, { deal_match_method: "confirmed" });
    let score = typeof row.proposed?.score === "number" ? (row.proposed.score as number) : null;
    // Le score calculé au meeting n'était pas rangé (rien avant confirmation) :
    // il l'est maintenant, sauf si le deal a été rescoré depuis la demande (le
    // calcul plus récent prime, et c'est lui qui part dans HubSpot).
    const pendingResult = (row.proposed?.scoreResult as ScoreOneDealResult | null | undefined) ?? null;
    if (pendingResult) {
      const { data: current } = await db.from("deal_scores").select("scored_at, score").eq("deal_id", deal.id).maybeSingle();
      const cur = current as { scored_at: string | null; score: { total?: number } | null } | null;
      const newer = !!cur?.scored_at && !!row.created_at && Date.parse(cur.scored_at) > Date.parse(row.created_at);
      if (newer) score = typeof cur?.score?.total === "number" ? Math.round(cur.score.total) : score;
      else await storeDealScore(deal.id, pendingResult);
    }
    const outcome = await applyMoveAndScore({ deal, row: { ...analysis, deal_match_method: "confirmed" }, score, via: "confirmation", actor });
    await patchAnalysis(analysis.id, { stage_move_result: outcome.moveResult, ...(outcome.moved ? { stage_moved_at: new Date().toISOString() } : {}) });
    const summary = outcome.lines.length ? outcome.lines.join("\n") : `:white_check_mark: Confirmed: the meeting stays linked to ${dealLink(deal)}. Nothing else to write.`;
    await closeRequest(row.request_key, "done", { answer: "yes", answeredBy: actor, result: outcome, text: doneText(`:white_check_mark: Confirmed.\n${summary}`, who) });
    return { ok: true, message: summary };
  } catch (e) {
    await closeRequest(row.request_key, "failed", { text: `:warning: Confirmation failed: ${errMsg(e)}. Nothing may have been written, check the card.` });
    return { ok: false, message: errMsg(e) };
  }
}

async function answerWithoutRequest(analysisId: string, answer: "yes" | "no", actor: string | null): Promise<ConfirmationAnswerResult> {
  const analysis = await loadAnalysis(analysisId);
  if (!analysis?.hubspot_deal_id) return { ok: false, message: "This meeting has no card." };
  if (answer === "no") {
    await patchAnalysis(analysisId, { stage_move_result: "rejected_by_user" });
    return { ok: true, message: "Noted, nothing was written. Use Change deal to pick the right card." };
  }
  const deal = await readGuardDeal(analysis.hubspot_deal_id);
  if (isTestRecording(analysis.claap_recording_id) !== isTestDealName(deal.dealname)) return { ok: false, message: "Test meetings only act on TEST cards." };
  const { data } = await db.from("deal_scores").select("score").eq("deal_id", deal.id).maybeSingle();
  const total = (data?.score as { total?: number } | null)?.total;
  await patchAnalysis(analysisId, { deal_match_method: "confirmed" });
  const outcome = await applyMoveAndScore({
    deal,
    row: { ...analysis, deal_match_method: "confirmed" },
    score: typeof total === "number" ? total : null,
    via: "confirmation",
    actor,
  });
  await patchAnalysis(analysisId, { stage_move_result: outcome.moveResult, ...(outcome.moved ? { stage_moved_at: new Date().toISOString() } : {}) });
  return { ok: true, message: outcome.lines.join("\n") || "Confirmed. Nothing else to write." };
}

/** Choix manuel d'une carte ("Change deal", "Link a deal") : méthode manual_link, demandes en attente fermées. */
export async function markManualLink(analysisId: string): Promise<void> {
  await patchAnalysis(analysisId, { deal_match_method: "manual_link" });
  await supersedePendingForAnalysis(analysisId, ":information_source: The deal of this meeting was changed in CoachelloHQ: this request is closed, nothing was written.").catch(() => 0);
}
