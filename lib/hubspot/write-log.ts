// Journal des écritures HubSpot gardées (table hubspot_write_log).
//
// Règle : pas de ligne de journal, pas d'écriture. La ligne est ouverte en
// 'pending' AVANT l'appel HubSpot et close après. Si l'insertion échoue (table
// absente, base indisponible), openWrite lève WriteLogUnavailableError et
// l'appelant n'écrit rien dans HubSpot.
//
// dedupe_key sert de réservation : une seconde écriture avec la même clé est
// refusée (duplicate). Elle est libérée si l'écriture HubSpot échoue.

import { db } from "@/lib/db";

export type WriteAction =
  | "create_deal"
  | "r1_to_scoping"
  | "score"
  | "type_offre"
  | "loss_category"
  | "reactivation"
  | "contact_unqualified"
  | "create_contact"
  | "create_company"
  | "archive_deal"
  | "create_task"
  | "update_task"
  | "complete_task";

export type WriteTrigger = "lead_validation" | "claap_call" | "confirmation" | "manual" | "test_script" | "meeting_announcement";

export interface OpenWriteInput {
  action: WriteAction;
  objectType: "deals" | "contacts" | "companies" | "tasks";
  objectId?: string | null;
  dedupeKey?: string | null;
  triggeredBy: WriteTrigger;
  actor?: string | null;
  mode?: string | null;
  isTest: boolean;
  before?: unknown;
  after?: unknown;
  leadId?: string | null;
  analysisId?: string | null;
}

export class WriteLogUnavailableError extends Error {}

export type OpenWriteResult = { id: string; duplicate?: false } | { duplicate: true };

export async function openWrite(input: OpenWriteInput): Promise<OpenWriteResult> {
  const { data, error } = await db
    .from("hubspot_write_log")
    .insert({
      action: input.action,
      object_type: input.objectType,
      object_id: input.objectId ?? null,
      dedupe_key: input.dedupeKey ?? null,
      triggered_by: input.triggeredBy,
      actor: input.actor ?? null,
      mode: input.mode ?? null,
      is_test: input.isTest,
      before_value: input.before ?? null,
      after_value: input.after ?? null,
      lead_id: input.leadId ?? null,
      analysis_id: input.analysisId ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { duplicate: true };
    throw new WriteLogUnavailableError(
      `hubspot_write_log unavailable (${error.message}). Apply supabase/migrations/hubspot_pipeline_switch.sql: nothing is written to HubSpot without a log line.`,
    );
  }
  return { id: data.id as string };
}

export async function closeWrite(
  id: string,
  result: { status: "done" | "failed"; objectId?: string | null; after?: unknown; error?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { status: result.status, completed_at: new Date().toISOString() };
  if (result.objectId !== undefined) patch.object_id = result.objectId;
  if (result.after !== undefined) patch.after_value = result.after;
  if (result.error !== undefined) patch.error = result.error;
  if (result.status === "failed") patch.dedupe_key = null; // libère la réservation, garde la trace
  const { error } = await db.from("hubspot_write_log").update(patch).eq("id", id);
  if (error) console.error(`[hubspot-write-log] close ${id} failed (the HubSpot write itself is ${result.status}):`, error.message);
}

/**
 * Écriture déjà réservée par cette clé : "done" (objet créé, à réutiliser) ou
 * "pending" (en cours, ou interrompue par un plantage). Une écriture "failed"
 * libère sa clé (closeWrite), elle n'est donc jamais renvoyée ici.
 */
export async function findWriteByDedupeKey(dedupeKey: string): Promise<{ id: string; status: string; objectId: string | null } | null> {
  const { data, error } = await db
    .from("hubspot_write_log")
    .select("id, status, object_id")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw new WriteLogUnavailableError(`hubspot_write_log unavailable: ${error.message}`);
  if (!data) return null;
  return { id: data.id as string, status: data.status as string, objectId: (data.object_id as string | null) ?? null };
}

/** Le SalesOS a-t-il déjà passé cette carte de R1 scheduled à Scoping ? (sert à on_new) */
export async function wasMovedToScopingBySalesOS(dealId: string): Promise<boolean> {
  const { data, error } = await db
    .from("hubspot_write_log")
    .select("id")
    .eq("action", "r1_to_scoping")
    .eq("object_id", dealId)
    .eq("status", "done")
    .limit(1);
  if (error) throw new WriteLogUnavailableError(`hubspot_write_log unavailable: ${error.message}`);
  return (data ?? []).length > 0;
}

export interface WriteLogRow {
  id: string;
  created_at: string;
  action: WriteAction;
  object_type: string;
  object_id: string | null;
  triggered_by: string;
  actor: string | null;
  mode: string | null;
  is_test: boolean;
  before_value: unknown;
  after_value: unknown;
  status: string;
  error: string | null;
  lead_id: string | null;
  analysis_id: string | null;
}

export async function listWrites(opts: { objectId?: string; testOnly?: boolean; action?: WriteAction; leadId?: string; sinceIso?: string; limit?: number } = {}): Promise<WriteLogRow[]> {
  let q = db
    .from("hubspot_write_log")
    .select("id, created_at, action, object_type, object_id, triggered_by, actor, mode, is_test, before_value, after_value, status, error, lead_id, analysis_id")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.objectId) q = q.eq("object_id", opts.objectId);
  if (opts.testOnly) q = q.eq("is_test", true);
  if (opts.action) q = q.eq("action", opts.action);
  if (opts.leadId) q = q.eq("lead_id", opts.leadId);
  if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
  const { data, error } = await q;
  if (error) throw new WriteLogUnavailableError(`hubspot_write_log unavailable: ${error.message}`);
  return (data ?? []) as WriteLogRow[];
}
