import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { loadClientContext, renderClientContextForPrompt, type ClientEnrichmentContext } from "./context";
import {
  CLIENT_EXTRACTION_MODEL,
  CLIENT_EXTRACTION_SYSTEM_PROMPT,
  CLIENT_FIELDS_TOOL,
} from "./prompt";
import { parseClientFieldsFromClaude } from "./parse-output";
import { fetchClientNews } from "./news";
import { rankClientNews } from "./rank-news";
import { computeHealth, computeInsights } from "./health";
import { generateHealthSummary } from "./health-summary";
import {
  SECTION_DEFINITIONS,
  type ClientFields,
  type ClientFieldValue,
  type RefreshReport,
  type SectionKey,
} from "./types";

// Refresh incrémental — version LÉGÈRE de l'enrichissement. Ne tourne que sur
// un client déjà 'done'. Prend en compte les activités nouvelles depuis le
// dernier passage, recalcule health + news (ranking IA), et si de nouvelles
// activités existent, ré-extrait les fields et diff contre l'existant en
// PRÉSERVANT les éditions manuelles. Ne régénère PAS coach brief ni deal recap
// (la partie lourde). Ne touche JAMAIS enrichment_status.

export type RunRefreshResult =
  | { ok: true; report: RefreshReport }
  | { ok: true; skipped: true; reason: "not_done" }
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
): Promise<RunRefreshResult> {
  const { data: row, error: rowErr } = await db
    .from("clients")
    .select(
      "id, hubspot_deal_id, enrichment_status, fields_json, health, health_history, last_enriched_at, last_refreshed_at",
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

    const ctx = await loadClientContext(row.hubspot_deal_id);

    const since = [row.last_refreshed_at, row.last_enriched_at]
      .filter((d): d is string => !!d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    const newActivityCount = countNewActivitiesSince(ctx, since);

    const companyName = ctx.deal?.company?.name ?? ctx.deal?.name ?? "";
    const prevScore =
      row.health && typeof row.health.score === "number" ? row.health.score : null;

    const updatePayload: Record<string, unknown> = {};
    let changedFields: RefreshReport["changed_fields"] = [];

    // ── Fields : ré-extraction seulement s'il y a du nouveau ──────────────────
    if (newActivityCount > 0) {
      const contextPrompt = renderClientContextForPrompt(ctx);
      const client = new Anthropic({ timeout: 600_000 });
      const msg = await withAnthropicRetry(
        () =>
          client.messages.create({
            model: CLIENT_EXTRACTION_MODEL,
            max_tokens: 8000,
            system: CLIENT_EXTRACTION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: contextPrompt }],
            tools: [CLIENT_FIELDS_TOOL],
            tool_choice: { type: "tool" as const, name: "client_fields" },
          }),
        { label: `clients/refresh/${clientId}` },
      );
      logUsage(userId, CLIENT_EXTRACTION_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "clients_refresh_fields");

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
    const insights = computeInsights(ctx, health);
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
