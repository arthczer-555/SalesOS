// Demandes de confirmation Slack (✅ / ❌), table slack_confirmations.
//
// Une demande = un ou plusieurs messages (un par destinataire) partageant la
// même request_key ; la première réponse ferme les autres. Une demande expire
// (7 jours par défaut) et se ferme dès que la question a été tranchée
// autrement (deal changé, meeting réanalysé). Le traitement métier d'une
// réponse vit chez l'appelant (lib/sales-coach/card-flow.ts).

import { db } from "@/lib/db";
import { updateMessage } from "@/lib/slack/api";
import { dmRecipient } from "@/lib/slack/lookup";

export type ConfirmationKind = "r1_move" | "deal_link" | "reactivation";
export type ConfirmationStatus = "pending" | "received" | "done" | "failed" | "expired" | "superseded";

export interface ConfirmationRow {
  id: string;
  kind: ConfirmationKind;
  request_key: string;
  slack_channel: string | null;
  slack_ts: string | null;
  slack_user_id: string | null;
  intended_user_id: string | null;
  mode: "test" | "live";
  analysis_id: string | null;
  deal_id: string | null;
  proposed: Record<string, unknown> | null;
  status: ConfirmationStatus;
  expires_at: string | null;
  answer: string | null;
  created_at: string | null;
}

const COLS = "id, kind, request_key, slack_channel, slack_ts, slack_user_id, intended_user_id, mode, analysis_id, deal_id, proposed, status, expires_at, answer, created_at";

/** Réactions et réponses acceptées. Slack écrit un emoji tapé sous la forme ":white_check_mark:". */
const YES = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check", "✅", "✔️", "✔", "☑️"]);
const NO = new Set(["x", "negative_squared_cross_mark", "heavy_multiplication_x", "❌", "❎", "✖️"]);

export function parseConfirmationAnswer(raw: string | null | undefined): "yes" | "no" | null {
  const t = (raw ?? "").trim().replace(/^:|:$/g, "").replace(/::skin-tone-\d$/, "").toLowerCase();
  if (!t) return null;
  if (YES.has(t)) return "yes";
  if (NO.has(t)) return "no";
  return null;
}

export async function hasPendingRequest(kind: ConfirmationKind, dealId: string): Promise<boolean> {
  const { data, error } = await db
    .from("slack_confirmations")
    .select("id")
    .eq("kind", kind)
    .eq("deal_id", dealId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw new Error(`slack_confirmations unavailable: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function createConfirmationRequest(input: {
  kind: ConfirmationKind;
  requestKey: string;
  recipients: { slackUserId: string; intendedUserId?: string | null }[];
  mode: "test" | "live";
  analysisId?: string | null;
  dealId?: string | null;
  proposed?: Record<string, unknown>;
  text: string;
  expiresInDays?: number;
}): Promise<{ sent: number; errors: string[] }> {
  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 7) * 24 * 3600 * 1000).toISOString();
  const errors: string[] = [];
  let sent = 0;
  const seen = new Set<string>();
  for (const r of input.recipients) {
    if (seen.has(r.slackUserId)) continue;
    seen.add(r.slackUserId);
    try {
      const { channelId, ts } = await dmRecipient(r.slackUserId, input.text);
      const { error } = await db.from("slack_confirmations").insert({
        kind: input.kind,
        request_key: input.requestKey,
        slack_channel: channelId,
        slack_ts: ts,
        slack_user_id: r.slackUserId,
        intended_user_id: r.intendedUserId ?? r.slackUserId,
        mode: input.mode,
        analysis_id: input.analysisId ?? null,
        deal_id: input.dealId ?? null,
        proposed: input.proposed ?? null,
        status: "pending",
        expires_at: expiresAt,
      });
      if (error) {
        // Message parti mais demande non enregistrée : on le corrige pour qu'aucun ✅ ne reste sans effet.
        if (ts) await updateMessage({ channel: channelId, ts, text: `${input.text}\n\n_(This request could not be saved: confirm in CoachelloHQ instead.)_` }).catch(() => null);
        errors.push(`save: ${error.message}`);
      } else {
        sent++;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { sent, errors };
}

export async function findConfirmationByMessage(channel: string, ts: string): Promise<ConfirmationRow | null> {
  const { data, error } = await db.from("slack_confirmations").select(COLS).eq("slack_channel", channel).eq("slack_ts", ts).maybeSingle();
  if (error) return null;
  return (data as ConfirmationRow | null) ?? null;
}

export async function getConfirmation(id: string): Promise<ConfirmationRow | null> {
  const { data } = await db.from("slack_confirmations").select(COLS).eq("id", id).maybeSingle();
  return (data as ConfirmationRow | null) ?? null;
}

export async function latestPendingForAnalysis(analysisId: string): Promise<ConfirmationRow | null> {
  const { data } = await db
    .from("slack_confirmations")
    .select(COLS)
    .eq("analysis_id", analysisId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as ConfirmationRow | undefined) ?? null;
}

/** pending -> received, de façon atomique : c'est ce qui garantit une seule exécution. */
export async function claimConfirmation(id: string): Promise<boolean> {
  const { data, error } = await db
    .from("slack_confirmations")
    .update({ status: "received", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Ferme toutes les lignes d'une demande et réécrit leurs messages Slack. */
export async function closeRequest(
  requestKey: string,
  status: Exclude<ConfirmationStatus, "pending" | "received">,
  opts: { text?: string; answer?: "yes" | "no"; answeredBy?: string | null; result?: unknown } = {},
): Promise<void> {
  const { data } = await db.from("slack_confirmations").select("id, slack_channel, slack_ts, status").eq("request_key", requestKey);
  const rows = (data ?? []) as { id: string; slack_channel: string | null; slack_ts: string | null; status: string }[];
  const now = new Date().toISOString();
  await db
    .from("slack_confirmations")
    .update({
      status,
      updated_at: now,
      ...(opts.answer ? { answer: opts.answer, answered_by: opts.answeredBy ?? null, answered_at: now } : {}),
      ...(opts.result !== undefined ? { result: opts.result } : {}),
    })
    .eq("request_key", requestKey);
  if (opts.text) {
    for (const r of rows) {
      if (r.slack_channel && r.slack_ts) {
        await updateMessage({ channel: r.slack_channel, ts: r.slack_ts, text: opts.text }).catch((e) =>
          console.warn("[slack-confirmations] message update failed:", e instanceof Error ? e.message : e),
        );
      }
    }
  }
}

/** Ferme les demandes en attente d'un meeting (deal changé, réanalyse...). */
export async function supersedePendingForAnalysis(analysisId: string, text: string): Promise<number> {
  const { data } = await db.from("slack_confirmations").select("request_key").eq("analysis_id", analysisId).eq("status", "pending");
  const keys = [...new Set(((data ?? []) as { request_key: string }[]).map((r) => r.request_key))];
  for (const key of keys) await closeRequest(key, "superseded", { text });
  return keys.length;
}
