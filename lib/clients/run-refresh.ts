import { db } from "../db";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { fetchDealContext } from "../hubspot";
import { getBillingForClient } from "../billing/google-sheet";
import { contextDealIds, loadClientContext, loadClaapMeetingsForDeals, renderClientContextForPrompt } from "./context";
import { discoverClaapMeetingCandidates } from "./claap-discovery";
import { discoverAccountCompanies } from "./account-discovery";
import {
  CLIENT_EXTRACTION_MODEL,
  CLIENT_EXTRACTION_SYSTEM_PROMPT,
  CLIENT_FIELDS_TOOL,
  CLIENT_REFRESH_PROMPT_ADDENDUM,
} from "./prompt";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { parseClientFieldsFromClaude } from "./parse-output";
import { mergeExtractedFields } from "./merge-fields";
import { fetchClientNews, mergeNewsHistory } from "./news";
import { rankClientNews } from "./rank-news";
import { computeHealth, computeInsights } from "./health";
import { generateHealthSummary, judgeRecentTone } from "./health-summary";
import { generateInsightsAI } from "./insights-ai";
import { generateCoachBrief } from "./coach-brief";
import { generateHubspotSuggestions } from "./hubspot-suggestions";
import { fetchHubspotDealFields } from "./hubspot-fields";
import { fetchClientSlackActivity } from "./slack-context";
import type {
  AccountCompany,
  ClientFields,
  ConfirmedRecording,
  Insights,
  News,
  RefreshReport,
} from "./types";
import { anthropicClient } from "@/lib/anthropic-client";
import { withForcedTool } from "../models/compat";

// Refresh incrémental d'un client déjà 'done' (bouton Refresh + cron hebdo du
// lundi). Lit les nouvelles activités depuis le dernier passage :
//   - Claap : nouveaux meetings détectés (domaine / titre) RETENUS
//     AUTOMATIQUEMENT, plus de popup de confirmation. Ils sont listés dans le
//     report (auto_added_meetings) avec un "Not this account" pour les retirer ;
//   - Companies du compte : détection des companies HubSpot du même compte
//     (account-discovery.ts), ajoutées en "pending" et confirmées ou retirées
//     depuis le panneau de la fiche ;
//   - HubSpot : engagements deal + deals liés + companies du compte ;
//   - Slack : canal dédié au client + mentions ailleurs (slack-context.ts) ;
//   - News : Tavily + Google News, triées "important pour le compte".
// S'il y a du nouveau, ré-extrait TOUS les fields et fusionne (merge-fields.ts :
// une édition manuelle n'est remplacée que par une source plus récente).
// Recalcule toujours health, Next actions, news ; régénère le coach brief si le
// périmètre a changé (sauf retouche manuelle) et les suggestions HubSpot ;
// resynchronise le billing (sauf en cron, où il est synchronisé en lot).
// Ne régénère pas le deal recap (histoire de la signature). Ne touche jamais
// enrichment_status.

export type RunRefreshResult =
  | { ok: true; report: RefreshReport }
  | { ok: true; skipped: true; reason: "not_done" }
  | { ok: false; error: string };

type ClientRefreshRow = {
  id: string;
  hubspot_deal_id: string;
  company_name: string;
  closedwon_at: string | null;
  enrichment_status: string;
  fields_json: Partial<ClientFields> | null;
  health: { score?: number } | null;
  health_history: unknown[] | null;
  insights: Insights | null;
  news: News | null;
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
  coach_brief_generated_at: string | null;
  coach_brief_edited_at?: string | null;
  // undefined tant que la migration clients_account_companies.sql n'est pas
  // appliquée (select("*") ne renvoie pas la colonne).
  account_companies?: AccountCompany[] | null;
  declined_company_ids?: string[] | null;
};

// Sections dont un changement rend le coach brief obsolète.
const BRIEF_SENSITIVE: Array<{ section: string; key?: string }> = [
  { section: "program_scope" },
  { section: "planning" },
  { section: "general_info", key: "langues_requises" },
  { section: "general_info", key: "zones_geographiques" },
];

function after(iso: string | null | undefined, sinceTs: number | null): boolean {
  if (!iso) return false;
  if (sinceTs === null) return true;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > sinceTs;
}

export async function runClientRefresh(
  clientId: string,
  userId: string | null = null,
  opts?: { trigger?: "manual" | "cron"; skipBilling?: boolean },
): Promise<RunRefreshResult> {
  const trigger = opts?.trigger ?? "manual";

  // select("*") plutôt qu'une liste : la colonne coach_brief_edited_at (migration
  // clients_v2_tabs_refresh.sql) peut ne pas exister encore, elle arrive alors
  // undefined et le refresh tourne quand même.
  const { data: row, error: rowErr } = await db
    .from("clients")
    .select("*")
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
    const notes: string[] = [];

    // ── Nouveaux meetings Claap : retenus automatiquement ─────────────────────
    // "Connu" = indexé sous ce deal ou un de ses deals liés (deal Customer
    // Success), déjà confirmé, déjà découvert ou retiré à la main. Tout recording
    // qui matche par domaine/titre en dehors de cet ensemble est nouveau, quelle
    // que soit sa date (ex. meeting lié à un autre deal).
    const declinedCompanyIds = new Set(row.declined_company_ids ?? []);
    const accountCompanies: AccountCompany[] = (row.account_companies ?? []).filter((c) => !declinedCompanyIds.has(c.id));
    const dealForDiscovery = await fetchDealContext(row.hubspot_deal_id, {
      includeLinkedDeals: true,
      accountCompanyIds: accountCompanies.map((c) => c.id),
      withEngagements: false,
    }).catch((e) => {
      console.warn(`[clients/refresh/${clientId}] deal fetch for meeting discovery failed:`, e instanceof Error ? e.message : e);
      return null;
    });

    // ── Companies du compte : détection des autres companies HubSpot du client ──
    // Ajoutées tout de suite (leur activité compte dès ce refresh) en "pending",
    // confirmées ou retirées depuis le panneau de la fiche. Ignoré tant que la
    // migration clients_account_companies.sql n'est pas appliquée.
    let addedCompanies: AccountCompany[] = [];
    if (row.account_companies !== undefined && dealForDiscovery) {
      const known = new Set([
        ...(dealForDiscovery.company ? [dealForDiscovery.company.id] : []),
        ...accountCompanies.map((c) => c.id),
        ...declinedCompanyIds,
      ]);
      const res = await discoverAccountCompanies(dealForDiscovery, known);
      if (res.error) {
        console.warn(`[clients/refresh/${clientId}] account check failed:`, res.error);
        notes.push(`The check for other HubSpot companies of this account failed: ${res.error}.`);
      }
      addedCompanies = res.companies;
      accountCompanies.push(...addedCompanies);
    }
    const indexedMeetings = await loadClaapMeetingsForDeals(contextDealIds(row.hubspot_deal_id, dealForDiscovery));
    const knownIds = new Set([
      ...indexedMeetings.map((m) => m.recording_id),
      ...(row.confirmed_claap_recordings ?? []).map((r) => r.recording_id),
      ...(row.discovered_claap_recordings ?? []).map((r) => r.recording_id),
      ...declinedIds,
    ]);
    let claapError: string | null = null;
    const newCandidates = await discoverClaapMeetingCandidates(dealForDiscovery, knownIds).catch((e) => {
      claapError = e instanceof Error ? e.message : String(e);
      console.warn(`[clients/refresh/${clientId}] new-meeting discovery failed:`, claapError);
      return [];
    });
    const autoConfirmed: ConfirmedRecording[] = newCandidates.map((c) => ({
      recording_id: c.recording_id,
      meeting_title: c.meeting_title,
      meeting_started_at: c.meeting_started_at,
      claap_url: c.claap_url,
      added_manually: false,
    }));

    const clientsModel = await getModelPreference("clients", CLIENT_EXTRACTION_MODEL);

    const ctx = await loadClientContext(row.hubspot_deal_id, {
      excludeRecordingIds: declinedIds.length > 0 ? declinedIds : undefined,
      accountCompanyIds: accountCompanies.map((c) => c.id),
    });
    const companyName = ctx.deal?.company?.name ?? ctx.deal?.name ?? row.company_name ?? "";

    const since = [row.last_refreshed_at, row.last_enriched_at]
      .filter((d): d is string => !!d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    const sinceTs = since ? new Date(since).getTime() : null;

    // ── Slack + champs HubSpot live (next step, fin de contrat) ───────────────
    const [slack, dealFields] = await Promise.all([
      fetchClientSlackActivity({
        companyName,
        lastReadAt: row.last_refreshed_at,
      }).catch((e) => ({
        channels: [] as Array<{ id: string; name: string }>,
        messages: [],
        errors: [`Slack failed (${e instanceof Error ? e.message : e})`],
      })),
      fetchHubspotDealFields(row.hubspot_deal_id),
    ]);
    ctx.slack = slack.messages;

    // ── Compteurs "nouveau depuis le dernier passage" ─────────────────────────
    const priorDiscoveredIds = new Set((row.discovered_claap_recordings ?? []).map((d) => d.recording_id));
    const newlyDiscoveredCount = ctx.meetings.filter((m) => m.is_discovered && !priorDiscoveredIds.has(m.recording_id)).length;
    const newClaap = ctx.meetings.filter((m) => after(m.meeting_started_at, sinceTs)).length;
    const claapNew = Math.max(newClaap, newlyDiscoveredCount);
    const hubspotNew = (ctx.deal?.engagements ?? []).filter((e) => after(e.date, sinceTs)).length;
    const slackNew = slack.messages.filter((m) => after(m.date, sinceTs)).length;
    const newActivityCount = claapNew + hubspotNew + slackNew;

    const prevScore = row.health && typeof row.health.score === "number" ? row.health.score : null;
    const updatePayload: Record<string, unknown> = {};
    let changedFields: RefreshReport["changed_fields"] = [];

    // Trace des recordings retenus ce cycle (discovered_at préservé), sinon un
    // futur refresh reflaguerait indéfiniment les mêmes meetings comme nouveaux.
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
    }
    // Ancien flux de confirmation : on purge les candidats restés en attente.
    updatePayload.pending_refresh_meeting_candidates = null;
    if (addedCompanies.length > 0) {
      // Relu juste avant l'écriture : un Keep / Remove cliqué pendant le refresh
      // ne doit pas être écrasé par la liste lue au départ.
      const { data: latest } = await db.from("clients").select("account_companies, declined_company_ids").eq("id", clientId).single();
      const latestList = (latest?.account_companies as AccountCompany[] | null) ?? [];
      const latestDeclined = new Set((latest?.declined_company_ids as string[] | null) ?? []);
      const latestIds = new Set(latestList.map((c) => c.id));
      updatePayload.account_companies = [
        ...latestList,
        ...addedCompanies.filter((c) => !latestIds.has(c.id) && !latestDeclined.has(c.id)),
      ];
    }

    // ── Fields (tous) : ré-extraction seulement s'il y a du nouveau ───────────
    // Une company ajoutée au compte compte comme du nouveau : son historique
    // (antérieur au dernier refresh) n'a jamais été lu.
    const contextPrompt = newActivityCount > 0 || addedCompanies.length > 0 ? renderClientContextForPrompt(ctx) : null;
    if (contextPrompt) {
      const client = anthropicClient({ timeout: 600_000 });
      const msg = await withAnthropicRetry(
        () =>
          client.messages.create(withForcedTool({
            model: clientsModel,
            max_tokens: 10000,
            system: `${CLIENT_EXTRACTION_SYSTEM_PROMPT}\n\n${CLIENT_REFRESH_PROMPT_ADDENDUM}\n\n${NO_EM_DASH_RULE}`,
            messages: [{ role: "user", content: contextPrompt }],
            tools: [CLIENT_FIELDS_TOOL],
          }, "client_fields")),
        { label: `clients/refresh/${clientId}` },
      );
      logUsage(userId, clientsModel, msg.usage.input_tokens, msg.usage.output_tokens, "clients_refresh_fields");

      const toolBlock = msg.content.find((b) => b.type === "tool_use");
      if (toolBlock && "input" in toolBlock) {
        const parsed = parseClientFieldsFromClaude(toolBlock.input);
        const { merged, changed } = mergeExtractedFields(row.fields_json ?? {}, parsed);
        changedFields = changed;
        if (changed.length > 0) updatePayload.fields_json = merged;
      }
    }
    const fieldsNow = (updatePayload.fields_json as Partial<ClientFields>) ?? row.fields_json ?? {};

    // ── En parallèle : news, billing, suggestions HubSpot, coach brief ────────
    const briefOutdated = changedFields.some((c) =>
      BRIEF_SENSITIVE.some((b) => b.section === c.section && (!b.key || b.key === c.key)),
    );
    const briefEditedByHand =
      !!row.coach_brief_edited_at &&
      (!row.coach_brief_generated_at || row.coach_brief_edited_at > row.coach_brief_generated_at);

    const newsPromise = fetchClientNews({ companyName, industry: ctx.deal?.company?.industry ?? null }).catch((e) => {
      console.warn(`[clients/refresh/${clientId}] news fetch failed:`, e instanceof Error ? e.message : e);
      return null;
    });
    const billingPromise =
      trigger === "cron" || opts?.skipBilling ? Promise.resolve(null) : getBillingForClient(companyName).catch(() => null);
    const suggestionsPromise = contextPrompt
      ? generateHubspotSuggestions(row.hubspot_deal_id, contextPrompt, userId).catch((e) => {
          console.warn(`[clients/refresh/${clientId}] hubspot suggestions failed:`, e instanceof Error ? e.message : e);
          return null;
        })
      : Promise.resolve(null);
    const briefPromise =
      briefOutdated && !briefEditedByHand
        ? generateCoachBrief(ctx, userId).catch((e) => {
            console.warn(`[clients/refresh/${clientId}] coach brief failed:`, e instanceof Error ? e.message : e);
            return null;
          })
        : Promise.resolve(null);
    if (briefOutdated && briefEditedByHand) {
      notes.push("The program changed but the coach brief was edited by hand, so it was not regenerated. Check it before sharing.");
    }

    // Ton des derniers meetings (signal du health). Un échec n'arrête rien :
    // le signal n'est pas noté et la carte le signale.
    const tonePromise = judgeRecentTone(ctx, userId).then(
      (tone) => ({ tone, error: null as string | null }),
      (e) => {
        console.warn(`[clients/refresh/${clientId}] tone judge failed:`, e instanceof Error ? e.message : e);
        return { tone: null, error: e instanceof Error ? e.message : String(e) };
      },
    );

    const [freshNews, billing, suggestions, coachBrief, toneRes] = await Promise.all([
      newsPromise,
      billingPromise,
      suggestionsPromise,
      briefPromise,
      tonePromise,
    ]);

    let newsNew = 0;
    let newsError: string | null = null;
    if (freshNews) {
      if (freshNews.items.length > 0) {
        const ranked = await rankClientNews(freshNews.items, {
          companyName,
          userId,
          feature: "clients_refresh_news_rank",
          programContext: [
            fieldsNow.program_scope?.nom_programme?.value,
            fieldsNow.program_scope?.population_accompagnee?.value,
          ].filter(Boolean).join(", ") || null,
        }).catch(() => ({ items: freshNews.items, ignored: 0 }));
        freshNews.items = ranked.items;
        freshNews.ignored_count = ranked.ignored;
      }
      const { news, newImportantCount } = mergeNewsHistory(row.news, freshNews);
      newsNew = newImportantCount;
      // Deux sources (web + Google News) : les deux KO = news injoignables ;
      // une seule KO = résultat partiel, signalé en note.
      const errs = freshNews.errors ?? [];
      if (errs.length >= 2) newsError = errs.join(" · ");
      else if (errs.length === 1) notes.push(`News are partial: ${errs[0]}.`);
      updatePayload.news = news;
      updatePayload.last_news_run_at = new Date().toISOString();
    } else {
      newsError = "News could not be loaded";
    }

    if (billing?.matched) {
      updatePayload.billing = billing;
      updatePayload.billing_refreshed_at = new Date().toISOString();
    }
    if (suggestions) updatePayload.hubspot_field_suggestions = suggestions.suggestions;
    if (coachBrief) {
      updatePayload.coach_brief = coachBrief;
      updatePayload.coach_brief_generated_at = new Date().toISOString();
    }

    // ── Health + Next actions : toujours recalculés ───────────────────────────
    const newsForInsights = (updatePayload.news as News | undefined) ?? row.news ?? null;
    const kickoff = fieldsNow.planning?.kickoff_envisage_le?.value;
    const health = computeHealth(ctx, prevScore, {
      closedwonAt: row.closedwon_at,
      kickoffDate: typeof kickoff === "string" ? kickoff : null,
      contractEndDate: dealFields?.contract_end_date ?? null,
      news: newsForInsights,
      tone: toneRes.tone,
      toneError: toneRes.error,
    });
    const aiInsights = await generateInsightsAI({
      ctx,
      health,
      fields: fieldsNow,
      news: newsForInsights,
      closedwonAt: row.closedwon_at,
      hubspotNextStep: dealFields?.hs_next_step ?? null,
      contractEndDate: dealFields?.contract_end_date ?? null,
      previous: row.insights,
      userId,
    }).catch((e) => {
      console.warn(`[clients/refresh/${clientId}] AI insights failed:`, e instanceof Error ? e.message : e);
      return null;
    });
    let insights: Insights;
    if (aiInsights) {
      insights = aiInsights;
    } else {
      // Fallback règles : on garde quand même les actions faites récemment.
      const fallback = computeInsights(ctx, health);
      const recentDone = (row.insights?.actions ?? []).filter(
        (a) => a.done_at && Date.now() - new Date(a.done_at).getTime() < 30 * 24 * 60 * 60 * 1000,
      );
      insights = { ...fallback, actions: [...fallback.actions, ...recentDone] };
    }
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
      trigger,
      health_before: prevScore,
      health_after: health.score,
      new_activity_count: newActivityCount,
      changed_fields: changedFields,
      sources: {
        claap: { new: claapNew, error: claapError },
        hubspot: {
          new: hubspotNew,
          error: ctx.deal ? null : "HubSpot deal could not be read",
          deals: ctx.deal
            ? [
                { id: ctx.deal.id, name: ctx.deal.name, pipeline_label: ctx.deal.pipeline_label },
                ...(ctx.deal.linked_deals ?? []),
              ]
            : [],
          companies: [
            ...(ctx.deal?.company ? [{ id: ctx.deal.company.id, name: ctx.deal.company.name, domain: ctx.deal.company.domain }] : []),
            ...accountCompanies.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          ],
        },
        slack: {
          new: slackNew,
          // Une erreur partielle (un canal illisible) n'invalide pas le reste : la
          // source n'est "KO" que si rien n'a pu être lu.
          error: slack.errors.length && slack.messages.length === 0 ? slack.errors.join(" · ") : null,
          channel: slack.channels.length ? slack.channels.map((c) => `#${c.name}`).join(", ") : null,
        },
        news: { new: newsNew, error: newsError },
      },
      auto_added_meetings: autoConfirmed.map((m) => ({
        recording_id: m.recording_id,
        meeting_title: m.meeting_title,
        meeting_started_at: m.meeting_started_at,
      })),
      notes: [...notes, ...(slack.messages.length > 0 ? slack.errors : [])].length
        ? [...notes, ...(slack.messages.length > 0 ? slack.errors : [])]
        : undefined,
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
          trigger,
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
