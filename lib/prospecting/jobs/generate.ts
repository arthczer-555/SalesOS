// Job "generate" : écrit les séquences d'un lot de prospects d'une campagne
// (concurrence 4). Les prospects sélectionnés passent en "queued", la
// progression est persistée après chaque prospect, l'annulation est vérifiée
// entre deux prospects, et un job relancé reprend là où il s'était arrêté (il
// ne traite que les prospects encore en queued/generating).
import { db } from "@/lib/db";
import { loadWritingContext } from "../ai/context";
import type { GenerateParams, GenerateScope } from "../ai/types";
import { writeSequenceForEnrollment } from "../ai/write-sequence";
import { getCampaign } from "../store/campaigns";
import { createJob, dispatchJob, findRunningJob, isJobCanceled, updateJob } from "../store/jobs";
import { chunk, mapLimit, nowIso } from "../store/util";
import type { ContentStatus, EnrollmentRow, JobRow } from "../types";

const CONCURRENCY = 4;
const LIVE_STATUSES = ["pending", "active", "paused"];
/** Une Background Function Netlify vit 15 min : on n'entame plus de prospect après 11 min. */
const RUN_BUDGET_MS = 11 * 60_000;
/** Job sans progression depuis 10 min = invocation morte (timeout, crash). */
const STALE_MS = 10 * 60_000;

function scopeStatuses(scope: GenerateScope): ContentStatus[] {
  switch (scope) {
    case "outdated":
      return ["outdated"];
    case "errors":
      return ["error"];
    case "all":
      return ["none", "queued", "generating", "ready", "error", "outdated"];
    case "missing":
    default:
      // queued/generating sans job actif = reste d'un job interrompu.
      return ["none", "queued", "generating"];
  }
}

export function parseGenerateParams(raw: Record<string, unknown>): GenerateParams {
  const scope = raw.scope;
  return {
    campaignId: String(raw.campaignId ?? ""),
    enrollmentIds: Array.isArray(raw.enrollmentIds) ? raw.enrollmentIds.filter((x): x is string => typeof x === "string").slice(0, 2000) : undefined,
    scope: scope === "outdated" || scope === "errors" || scope === "all" || scope === "missing" ? scope : undefined,
    force: raw.force === true,
  };
}

/** Paramètres internes d'un job de continuation (posés par le job lui-même, jamais par l'API). */
interface ContinuationParams {
  onlyMissing?: boolean;
  carry?: { total: number; done: number; errors: number; written: number };
}

function parseContinuation(raw: Record<string, unknown>): ContinuationParams {
  const c = raw.carry as Partial<NonNullable<ContinuationParams["carry"]>> | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    onlyMissing: typeof raw.onlyMissing === "boolean" ? raw.onlyMissing : undefined,
    carry: c && typeof c === "object" ? { total: num(c.total), done: num(c.done), errors: num(c.errors), written: num(c.written) } : undefined,
  };
}

/**
 * Job de génération vivant sur la campagne. Un job qui ne progresse plus depuis
 * 10 min est marqué en erreur : sinon il bloquerait toute nouvelle génération
 * (un seul job à la fois) et l'UI afficherait une barre figée.
 */
export async function liveGenerateJob(campaignId: string): Promise<JobRow | null> {
  const job = await findRunningJob(campaignId, "generate");
  if (!job) return null;
  if (Date.now() - new Date(job.updated_at).getTime() < STALE_MS) return job;
  await updateJob(job.id, { status: "error", error: "The generation stopped responding. Start it again to finish the remaining prospects.", finished_at: nowIso() });
  return null;
}

/** Prospects ciblés par une génération (sans les modifier). */
export async function selectEnrollments(campaignId: string, params: Pick<GenerateParams, "enrollmentIds" | "scope">): Promise<Pick<EnrollmentRow, "id" | "content_status">[]> {
  const out: Pick<EnrollmentRow, "id" | "content_status">[] = [];
  if (params.enrollmentIds?.length) {
    for (const ids of chunk(params.enrollmentIds, 200)) {
      const { data, error } = await db
        .from("prospecting_enrollments")
        .select("id, content_status")
        .eq("campaign_id", campaignId)
        .in("id", ids)
        .in("status", LIVE_STATUSES);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as Pick<EnrollmentRow, "id" | "content_status">[]));
    }
    return out;
  }
  const statuses = scopeStatuses(params.scope ?? "missing");
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("prospecting_enrollments")
      .select("id, content_status")
      .eq("campaign_id", campaignId)
      .in("status", LIVE_STATUSES)
      .in("content_status", statuses)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Pick<EnrollmentRow, "id" | "content_status">[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

interface GenerateState {
  enrollmentIds: string[];
  previous: Record<string, ContentStatus>;
}

export async function runGenerateJob(job: JobRow): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const params = parseGenerateParams(job.params);
  const cont = parseContinuation(job.params);
  const campaignId = params.campaignId || job.campaign_id || "";
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  // Reprise : la liste figée au premier passage est conservée dans job.result.
  const saved = job.result as Partial<GenerateState> | null;
  let state: GenerateState;
  if (saved?.enrollmentIds?.length) {
    state = { enrollmentIds: saved.enrollmentIds, previous: saved.previous ?? {} };
  } else {
    const selected = await selectEnrollments(campaign.id, params);
    state = { enrollmentIds: selected.map((e) => e.id), previous: Object.fromEntries(selected.map((e) => [e.id, e.content_status])) };
    for (const ids of chunk(state.enrollmentIds, 200)) {
      await db.from("prospecting_enrollments").update({ content_status: "queued", content_error: null, updated_at: nowIso() }).in("id", ids);
    }
    await updateJob(job.id, { result: { ...state } });
  }

  // Ne traite que ce qui reste à faire (reprise après interruption).
  const pending: string[] = [];
  for (const ids of chunk(state.enrollmentIds, 200)) {
    const { data } = await db.from("prospecting_enrollments").select("id, content_status").in("id", ids).in("content_status", ["queued", "generating"]);
    pending.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
  }
  // Un job de continuation reprend les compteurs du job précédent.
  const total = cont.carry?.total || state.enrollmentIds.length;
  let done = (cont.carry?.done ?? 0) + (state.enrollmentIds.length - pending.length);
  let errors = cont.carry?.errors ?? 0;
  let written = cont.carry?.written ?? 0;
  await updateJob(job.id, { progress: { total, done, errors, label: total ? "Writing sequences" : "Nothing to generate" } });
  if (!pending.length) return { total, done, errors, written };

  const ctx = await loadWritingContext(campaign);
  // Avec force ou un scope "all", on réécrit les étapes déjà écrites ; sinon on
  // complète seulement ce qui manque ou a changé.
  const onlyMissing = cont.onlyMissing ?? (!params.force && !params.enrollmentIds?.length && params.scope !== "all" && params.scope !== "errors");
  const budgeted = process.env.NETLIFY === "true";
  let canceled = false;
  let outOfTime = false;

  await mapLimit(pending, CONCURRENCY, async (enrollmentId) => {
    if (canceled || outOfTime) return;
    if (budgeted && Date.now() - startedAt > RUN_BUDGET_MS) {
      outOfTime = true;
      return;
    }
    if (await isJobCanceled(job.id)) {
      canceled = true;
      return;
    }
    const r = await writeSequenceForEnrollment(enrollmentId, { force: params.force, onlyMissing, ctx, background: true });
    done++;
    written += r.written;
    if (r.error) errors++;
    await updateJob(job.id, { progress: { total, done, errors, label: canceled ? "Canceling" : `Writing sequences (${done}/${total})` } });
  });

  // Budget de la fonction épuisé : un nouveau job reprend les prospects restants.
  if (outOfTime && !canceled) {
    const { data } = await db.from("prospecting_enrollments").select("id").in("id", pending).eq("content_status", "queued");
    const remaining = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (remaining.length) {
      const next = await createJob({
        userId: job.user_id,
        kind: "generate",
        campaignId: campaign.id,
        params: { campaignId: campaign.id, enrollmentIds: remaining, force: params.force, onlyMissing, carry: { total, done, errors, written } },
        total,
        label: "Writing sequences",
      });
      await updateJob(next.id, { progress: { total, done, errors, label: `Writing sequences (${done}/${total})` } });
      await updateJob(job.id, { progress: { total, done, errors, label: "Continued in a new run" } });
      await dispatchJob(next, process.env.URL ?? process.env.SITE_URL ?? "");
      return { total, done, errors, written, continuedIn: next.id };
    }
  }

  if (canceled) {
    // Les prospects pas encore traités retrouvent leur statut d'avant le job.
    const { data } = await db.from("prospecting_enrollments").select("id").in("id", pending).eq("content_status", "queued");
    for (const row of (data ?? []) as { id: string }[]) {
      await db
        .from("prospecting_enrollments")
        .update({ content_status: state.previous[row.id] && state.previous[row.id] !== "queued" ? state.previous[row.id] : "none", updated_at: nowIso() })
        .eq("id", row.id)
        .eq("content_status", "queued");
    }
  }
  return { total, done, errors, written, canceled };
}
