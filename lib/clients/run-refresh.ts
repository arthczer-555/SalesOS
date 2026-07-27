import { db } from "../db";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { fetchDealContext } from "../hubspot";
import { loadClientContext, loadClaapMeetingsForDeal, renderClientContextForPrompt, type ClientEnrichmentContext } from "./context";
import { discoverClaapMeetingCandidates } from "./claap-discovery";
import {
  CLIENT_EXTRACTION_MODEL,
  CLIENT_EXTRACTION_SYSTEM_PROMPT,
  CLIENT_FIELDS_TOOL,
} from "./prompt";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { parseClientFieldsFromClaude } from "./parse-output";
import { fetchClientNews } from "./news";
import { rankClientNews } from "./rank-news";
import { computeHealth, computeInsights } from "./health";
import { generateHealthSummary } from "./health-summary";
import { generateInsightsAI } from "./insights-ai";
import {
  SECTION_DEFINITIONS,
  type ClientFields,
  type ClientFieldValue,
  type ConfirmedRecording,
  type MeetingCandidate,
  type RefreshReport,
  type SectionKey,
} from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Refresh incrémental — version LÉGÈRE de l'enrichissement. Ne tourne que sur
// un client déjà 'done'. Prend en compte les activités nouvelles depuis le
// dernier passage, recalcule health + news (ranking IA), et si de nouvelles
// activités existent, ré-extrait les fields et diff contre l'existant en
// PRÉSERVANT les éditions manuelles. Ne régénère PAS coach brief ni deal recap
// (la partie lourde). Ne touche JAMAIS enrichment_status.

export type RunRefreshResult =
  | { ok: true; report: RefreshReport }
  | { ok: true; skipped: true; reason: "not_done" }
  | { ok: true; needsConfirmation: true; candidates: MeetingCandidate[] }
  | { ok: false; error: string };

type ClientRefreshRow = {
  id: string;
  hubspot_deal_id: string;
  enrichment_status: string;
  fields_json: Partial<ClientFields> | null;
  health: { score?: number } | null;
  health_history: unknown[] | null;
  last_enriched_at: string | null;
  last_refreshed_at: string | null;
  confirmed_claap_recordings: ConfirmedRecording[] | null;
  discovered_claap_recordings: Array<{
    recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    claap_url: string | null;
    discovered_at: string;
  }> | null;
  declined_claap_recording_ids: string[] | null;
};

// Compte les activités (engagements HubSpot + meetings Claap) postérieures à
// `since`. since = max(last_refreshed_at, last_enriched_at). Si since est null,
// tout est considéré comme nouveau. Les timestamps null sont ignorés pour la
// décision (on ne peut pas prouver la récence) mais restent dans le prompt.
function countNewActivitiesSince(ctx: ClientEnrichmentContext, since: string | null): number {
  if (!since) {
    return (ctx.deal?.engagements?.length ?? 0) + (ctx.meetings?.length ?? 0);
  }
  const sinceTs = new Date(since).getTime();
  let count = 0;
  for (const e of ctx.deal?.engagements ?? []) {
    if (e.date && new Date(e.date).getTime() > sinceTs) count++;
  }
  for (const m of ctx.meetings ?? []) {
    if (m.meeting_started_at && new Date(m.meeting_started_at).getTime() > sinceTs) count++;
  }
  return count;
}

// Normalise une valeur pour comparaison stable (arrays triés, objets via JSON).
function normalizeForCompare(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)));
    return JSON.stringify([...items].sort());
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Merge la ré-extraction contre l'existant en préservant les fields manuels et
// en ne remplaçant que quand la nouvelle valeur est non-nulle ET différente.
// Renvoie le fields_json fusionné + la liste des fields qui ont changé.
function mergeFieldsPreservingManual(
  prev: Partial<ClientFields>,
  next: Partial<ClientFields>,
): { merged: Partial<ClientFields>; changed: RefreshReport["changed_fields"] } {
  const merged: Record<string, Record<string, ClientFieldValue>> = {};
  const changed: RefreshReport["changed_fields"] = [];

  for (const section of SECTION_DEFINITIONS) {
    const sectionKey = section.key as SectionKey;
    const prevSection = (prev?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const nextSection = (next?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const out: Record<string, ClientFieldValue> = { ...prevSection };

    for (const field of section.fields) {
      const prevField = prevSection[field.key];
      const nextField = nextSection[field.key];

      // Field édité manuellement : on ne touche jamais, pas compté comme changé.
      if (prevField?.source?.kind === "manual") continue;

      if (!nextField) continue;
      // Ne pas blanchir un field que la ré-extraction n'a pas re-trouvé.
      if (nextField.value == null) continue;

      const prevNorm = normalizeForCompare(prevField?.value ?? null);
      const nextNorm = normalizeForCompare(nextField.value);
      if (prevNorm !== nextNorm) {
        out[field.key] = nextField;
        changed.push({ section: sectionKey, key: field.key, label: field.label });
      }
    }

    merged[sectionKey] = out;
  }

  return { merged: merged as Partial<ClientFields>, changed };
}

export async function runClientRefresh(
  clientId: string,
  userId: string | null = null,
  opts?: { trigger?: "manual" | "cron" },
): Promise<RunRefreshResult> {
  const trigger = opts?.trigger ?? "manual";

  const { data: row, error: rowErr } = await db
    .from("clients")
    .select(
      "id, hubspot_deal_id, enrichment_status, fields_json, health, health_history, last_enriched_at, last_refreshed_at, confirmed_claap_recordings, discovered_claap_recordings, declined_claap_recording_ids",
    )
    .eq("id", clientId)
    .single<ClientRefreshRow>();

  if (rowErr || !row) return { ok: false, error: rowErr?.message ?? "Client not found" };

  // Le refresh ne tourne que sur un client déjà enrichi. Un client pending/
  // running/error doit d'abord passer par l'enrichissement complet.
  if (row.enrichment_status !== "done") {
    return { ok: true, skipped: true, reason: "not_done" };
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

    const declinedIds = row.declined_claap_recording_ids ?? [];

    // ── Détection des NOUVEAUX meetings Claap pour ce client ──────────────────
    // "Connu" = indexé sous ce deal (sales_coach_analyses status=done), déjà
    // confirmé, déjà découvert lors d'un refresh précédent, ou explicitement
    // décliné. Tout recording qui matche par domaine/titre en dehors de cet
    // ensemble est un candidat "nouveau" pour ce client. On ne se base PAS sur
    // une fenêtre de date : un meeting jamais vu par le pipeline (ex. lié à un
    // deal HubSpot différent créé après le closed-won) doit être détecté même
    // s'il est chronologiquement ancien.
    const [indexedMeetings, dealForDiscovery] = await Promise.all([
      loadClaapMeetingsForDeal(row.hubspot_deal_id),
      fetchDealContext(row.hubspot_deal_id).catch((e) => {
        console.warn(
          `[clients/refresh/${clientId}] deal fetch for meeting discovery failed:`,
          e instanceof Error ? e.message : e,
        );
        return null;
      }),
    ]);
    const knownIds = new Set([
      ...indexedMeetings.map((m) => m.recording_id),
      ...(row.confirmed_claap_recordings ?? []).map((r) => r.recording_id),
      ...(row.discovered_claap_recordings ?? []).map((r) => r.recording_id),
      ...declinedIds,
    ]);
    const newCandidates = await discoverClaapMeetingCandidates(dealForDiscovery, knownIds).catch((e) => {
      console.warn(
        `[clients/refresh/${clientId}] new-meeting discovery failed:`,
        e instanceof Error ? e.message : e,
      );
      return [] as MeetingCandidate[];
    });

    // Refresh manuel + nouveau(x) meeting(s) : on s'arrête ici, rien d'autre
    // n'est mis à jour (health/news/fields compris) tant qu'un humain n'a pas
    // confirmé ou décliné. Cf. app/api/clients/[id]/confirm-refresh-meetings.
    if (newCandidates.length > 0 && trigger === "manual") {
      await db
        .from("clients")
        .update({
          pending_refresh_meeting_candidates: newCandidates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);
      return { ok: true, needsConfirmation: true, candidates: newCandidates };
    }

    // Refresh cron + nouveau(x) meeting(s) : pas d'humain disponible, on les
    // retient directement (tracé dans confirmed_claap_recordings). La discovery
    // aveugle plus bas les remontera de toute façon (même matching domaine/
    // titre) ; cet append sert la traçabilité et évite qu'un futur refresh
    // manuel les reflague comme "nouveaux".
    const autoConfirmed: ConfirmedRecording[] =
      newCandidates.length > 0
        ? newCandidates.map((c) => ({
            recording_id: c.recording_id,
            meeting_title: c.meeting_title,
            meeting_started_at: c.meeting_started_at,
            claap_url: c.claap_url,
            added_manually: false,
          }))
        : [];

    const clientsModel = await getModelPreference("clients", CLIENT_EXTRACTION_MODEL);

    const ctx = await loadClientContext(row.hubspot_deal_id, {
      excludeRecordingIds: declinedIds.length > 0 ? declinedIds : undefined,
    });

    const since = [row.last_refreshed_at, row.last_enriched_at]
      .filter((d): d is string => !!d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    // Meetings jamais vus par le pipeline avant ce cycle (nouvellement inclus
    // dans ctx.meetings via la discovery), indépendamment de leur date. Capture
    // le cas où un meeting matché par domaine/titre est antérieur à `since`
    // (ex. lié à un deal HubSpot différent créé après le closed-won) : sans ce
    // signal, countNewActivitiesSince le raterait et les fields ne seraient
    // jamais ré-extraits alors que le meeting vient tout juste d'être retenu.
    const priorDiscoveredIds = new Set((row.discovered_claap_recordings ?? []).map((d) => d.recording_id));
    const newlyDiscoveredCount = ctx.meetings.filter(
      (m) => m.is_discovered && !priorDiscoveredIds.has(m.recording_id),
    ).length;
    const newActivityCount = countNewActivitiesSince(ctx, since) + newlyDiscoveredCount;

    const companyName = ctx.deal?.company?.name ?? ctx.deal?.name ?? "";
    const prevScore =
      row.health && typeof row.health.score === "number" ? row.health.score : null;

    const updatePayload: Record<string, unknown> = {};
    let changedFields: RefreshReport["changed_fields"] = [];

    // Trace des recordings retenus ce cycle (existants + nouveaux), avec
    // discovered_at préservé pour ceux déjà connus. Persisté à chaque refresh
    // (pas seulement à l'enrichissement initial), sinon un futur refresh
    // reflague indéfiniment les mêmes meetings comme "nouveaux".
    const priorDiscoveredById = new Map((row.discovered_claap_recordings ?? []).map((d) => [d.recording_id, d]));
    updatePayload.discovered_claap_recordings = ctx.meetings
      .filter((m) => m.is_discovered)
      .map((m) => ({
        recording_id: m.recording_id,
        meeting_title: m.meeting_title,
        meeting_started_at: m.meeting_started_at,
        claap_url: m.claap_url ?? null,
        discovered_at: priorDiscoveredById.get(m.recording_id)?.discovered_at ?? new Date().toISOString(),
      }));

    if (autoConfirmed.length > 0) {
      updatePayload.confirmed_claap_recordings = [...(row.confirmed_claap_recordings ?? []), ...autoConfirmed];
      updatePayload.pending_refresh_meeting_candidates = null;
    }

    // ── Fields : ré-extraction seulement s'il y a du nouveau ──────────────────
    if (newActivityCount > 0) {
      const contextPrompt = renderClientContextForPrompt(ctx);
      const client = anthropicClient({ timeout: 600_000 });
      const msg = await withAnthropicRetry(
        () =>
          client.messages.create({
            model: clientsModel,
            max_tokens: 8000,
            system: `${CLIENT_EXTRACTION_SYSTEM_PROMPT}\n\n${NO_EM_DASH_RULE}`,
            messages: [{ role: "user", content: contextPrompt }],
            tools: [CLIENT_FIELDS_TOOL],
            tool_choice: { type: "tool" as const, name: "client_fields" },
          }),
        { label: `clients/refresh/${clientId}` },
      );
      logUsage(userId, clientsModel, msg.usage.input_tokens, msg.usage.output_tokens, "clients_refresh_fields");

      const toolBlock = msg.content.find((b) => b.type === "tool_use");
      if (toolBlock && "input" in toolBlock) {
        const parsed = parseClientFieldsFromClaude(toolBlock.input);
        const { merged, changed } = mergeFieldsPreservingManual(row.fields_json ?? {}, parsed);
        changedFields = changed;
        if (changed.length > 0) updatePayload.fields_json = merged;
      }
    }

    // ── News : toujours rafraîchies + rankées (best-effort) ───────────────────
    const news = await fetchClientNews({
      companyName,
      industry: ctx.deal?.company?.industry ?? null,
    }).catch((e) => {
      console.warn(`[clients/refresh/${clientId}] news fetch failed:`, e instanceof Error ? e.message : e);
      return null;
    });
    if (news) {
      if (news.items.length > 0) {
        news.items = await rankClientNews(news.items, {
          companyName,
          userId,
          feature: "clients_refresh_news_rank",
        }).catch(() => news.items);
      }
      updatePayload.news = news;
      updatePayload.last_news_run_at = new Date().toISOString();
    }

    // ── Health : toujours recalculé ───────────────────────────────────────────
    const health = computeHealth(ctx, prevScore);
    // Reco IA (anglais, orientée closed-won), best-effort -> fallback règles EN.
    const fieldsForInsights =
      (updatePayload.fields_json as Partial<ClientFields>) ?? (row.fields_json ?? {});
    const insights =
      (await generateInsightsAI(ctx, health, fieldsForInsights, userId).catch((e) => {
        console.warn(`[clients/refresh/${clientId}] AI insights failed:`, e instanceof Error ? e.message : e);
        return null;
      })) ?? computeInsights(ctx, health);
    health.summary = await generateHealthSummary(ctx, health, userId).catch((e) => {
      console.warn(`[clients/refresh/${clientId}] health summary failed:`, e instanceof Error ? e.message : e);
      return null;
    });

    const existingHistory = Array.isArray(row.health_history) ? row.health_history : [];
    const trimmedHistory = [
      ...existingHistory,
      { score: health.score, label: health.label, drivers: health.drivers, computed_at: health.computed_at },
    ].slice(-24);

    const report: RefreshReport = {
      refreshed_at: new Date().toISOString(),
      health_before: prevScore,
      health_after: health.score,
      new_activity_count: newActivityCount,
      changed_fields: changedFields,
      skipped_no_activity: newActivityCount === 0,
    };

    updatePayload.health = health;
    updatePayload.health_history = trimmedHistory;
    updatePayload.insights = insights;
    updatePayload.last_health_run_at = new Date().toISOString();
    updatePayload.last_refreshed_at = report.refreshed_at;
    updatePayload.last_refresh_report = report;
    updatePayload.updated_at = report.refreshed_at;

    const { error: updateErr } = await db.from("clients").update(updatePayload).eq("id", clientId);
    if (updateErr) throw new Error(`refresh update failed: ${updateErr.message}`);

    return { ok: true, report };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[clients/refresh/${clientId}] error:`, errMsg);
    // On NE bascule PAS enrichment_status en "error" : la dernière fiche valide
    // reste affichée. On note juste l'échec dans le report.
    await db
      .from("clients")
      .update({
        last_refresh_report: {
          refreshed_at: new Date().toISOString(),
          health_before: null,
          health_after: null,
          new_activity_count: 0,
          changed_fields: [],
          error: errMsg,
        } satisfies RefreshReport,
      })
      .eq("id", clientId);
    return { ok: false, error: errMsg };
  }
}
