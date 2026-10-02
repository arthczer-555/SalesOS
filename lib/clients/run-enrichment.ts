import { db } from "../db";
import { logUsage } from "../log-usage";
import { withAnthropicRetry } from "../anthropic-retry";
import { loadClientContext, renderClientContextForPrompt } from "./context";
import {
  CLIENT_EXTRACTION_MODEL,
  CLIENT_EXTRACTION_SYSTEM_PROMPT,
  CLIENT_FIELDS_TOOL,
} from "./prompt";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { parseClientFieldsFromClaude } from "./parse-output";
import { generateCoachBrief } from "./coach-brief";
import { generateDealRecap } from "./deal-recap";
import { fetchClientNews, mergeNewsHistory } from "./news";
import { mergeExtractedFields } from "./merge-fields";
import { rankClientNews } from "./rank-news";
import { getBillingForClient } from "../billing/google-sheet";
import { computeHealth, computeInsights } from "./health";
import { generateHealthSummary, judgeRecentTone } from "./health-summary";
import { generateInsightsAI } from "./insights-ai";
import { notifyOwnerOfEnrichedClient } from "./notify-owner";
import { generateHubspotSuggestions } from "./hubspot-suggestions";
import { fetchHubspotDealFields } from "./hubspot-fields";
import type { ClientFields, News } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

export type RunEnrichmentResult =
  | { ok: true; alreadyDone?: boolean }
  | { ok: false; error: string };

// Orchestrateur principal pour /clients/:id enrichissement.
//
// Pipeline complet (étapes 2-7 du plan §7) :
//   1. Verrouille la row (enrichment_status = 'running').
//   2. Charge le contexte HubSpot + Claap pour le deal.
//   3. En parallèle :
//        - Extraction des 6 sections de fields (Claude Sonnet 4.6)
//        - Brief coachs (Claude Sonnet 4.6)
//        - Recap deal IA (Claude Sonnet 4.6)
//        - News entreprise (Tavily, pas d'IA)
//   4. Calcul du health + insights (règles simples, pas d'IA).
//   5. Écrit tout, bascule en 'done'.
//
// Sécurité fields manuels : on merge avec les fields existants (mergeExtractedFields,
// même règle que le refresh). Une édition manuelle est conservée, sauf si une
// source datée APRÈS l'édition dit autre chose (cf. merge-fields.ts).
//
// Côté health : on garde un historique snapshot dans health_history pour
// pouvoir tracer la trend mois après mois (utile quand on branchera le cron).
// userId : utilisateur à qui imputer le coût IA dans usage_logs. null pour les
// déclenchements système (webhook closed-won, cron) qui n'ont pas de contexte
// user. Le trigger manuel (bouton admin) passe l'id de l'admin qui clique.
export async function runClientEnrichment(
  clientId: string,
  userId: string | null = null,
): Promise<RunEnrichmentResult> {
  const { data: row, error: rowErr } = await db
    .from("clients")
    .select("id, hubspot_deal_id, closedwon_at, enrichment_status, updated_at, health, health_history, confirmed_claap_recordings, fields_json, news")
    .eq("id", clientId)
    .single();

  if (rowErr || !row) {
    return { ok: false, error: rowErr?.message ?? "Client not found" };
  }
  if (row.enrichment_status === "done") {
    // L'appelant peut forcer un re-enrich via /api/clients/[id]/re-enrich
    // (batch 4), qui repassera explicitement en 'pending'. Tant que c'est
    // 'done', on ne refait rien.
    return { ok: true, alreadyDone: true };
  }
  if (row.enrichment_status === "running") {
    const ageMin = row.updated_at
      ? (Date.now() - new Date(row.updated_at).getTime()) / 60_000
      : Infinity;
    // Si une run précédente est verrouillée mais a moins de 10 minutes, on
    // suppose qu'elle est en cours et on n'en relance pas une seconde.
    if (ageMin < 10) return { ok: true, alreadyDone: true };
  }

  await db
    .from("clients")
    .update({ enrichment_status: "running", enrichment_error: null, updated_at: new Date().toISOString() })
    .eq("id", clientId);

  try {
    // Si l'humain a confirmé une liste de meetings (flux closed-won/import avec
    // garde-fou), on charge exactement ces recordings. Sinon (re-enrich, refresh
    // cron) on laisse loadClientContext faire sa discovery automatique.
    const confirmed = Array.isArray(row.confirmed_claap_recordings)
      ? (row.confirmed_claap_recordings as Array<{ recording_id?: string }>)
          .map((r) => r.recording_id)
          .filter((id): id is string => !!id)
      : null;
    const ctx = await loadClientContext(
      row.hubspot_deal_id,
      confirmed && confirmed.length > 0 ? { confirmedRecordingIds: confirmed } : undefined,
    );
    const contextPrompt = renderClientContextForPrompt(ctx);

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY missing");
    }

    const clientsModel = await getModelPreference("clients", CLIENT_EXTRACTION_MODEL);
    const client = anthropicClient({ timeout: 600_000 });

    // Lance fields + coach brief EN PARALLÈLE. Même contexte d'input, on
    // doublonne les tokens d'entrée mais on divise le temps total par 2.
    // Le brief est best-effort : s'il échoue, l'enrichissement réussit
    // quand même (les fields sont la donnée critique). Cf [[no_translation]] :
    // le brief s'écrit dans la langue dominante des transcripts.
    const fieldsPromise = withAnthropicRetry(
      () =>
        client.messages.create({
          model: clientsModel,
          max_tokens: 8000,
          system: `${CLIENT_EXTRACTION_SYSTEM_PROMPT}\n\n${NO_EM_DASH_RULE}`,
          messages: [{ role: "user", content: contextPrompt }],
          tools: [CLIENT_FIELDS_TOOL],
          tool_choice: { type: "tool" as const, name: "client_fields" },
        }),
      { label: `clients/enrich/${clientId}` },
    );

    const briefPromise = generateCoachBrief(ctx, userId).catch((e) => {
      console.warn(
        `[clients/enrich/${clientId}] coach brief generation failed:`,
        e instanceof Error ? e.message : e,
      );
      return null;
    });

    const recapPromise = generateDealRecap(ctx, userId).catch((e) => {
      console.warn(
        `[clients/enrich/${clientId}] deal recap generation failed:`,
        e instanceof Error ? e.message : e,
      );
      return null;
    });

    // News : best-effort, Tavily peut être down ou ne rien retourner.
    const newsPromise = fetchClientNews({
      companyName: ctx.deal?.company?.name ?? ctx.deal?.name ?? "",
      industry: ctx.deal?.company?.industry ?? null,
    }).catch((e) => {
      console.warn(`[clients/enrich/${clientId}] news fetch failed:`, e instanceof Error ? e.message : e);
      return null;
    });

    // Billing : best-effort, contexte facturation depuis le fichier revenue
    // (Google Drive). Pas d'IA, coût nul. Affiché immédiatement sur la fiche
    // sans attendre le cron mensuel.
    const billingPromise = getBillingForClient(
      ctx.deal?.company?.name ?? ctx.deal?.name ?? "",
    ).catch((e) => {
      console.warn(`[clients/enrich/${clientId}] billing fetch failed:`, e instanceof Error ? e.message : e);
      return null;
    });

    // Suggestions de remplissage des champs HubSpot vides (checklist colonne
    // gauche), generees d'office pour qu'elles soient pretes a l'ouverture de la
    // fiche sans clic sur "Analyze". Best-effort : un echec ne casse pas
    // l'enrichissement. Tourne en parallele (Haiku ~15s) -> n'ajoute pas de
    // temps mur. On reutilise le contexte deal deja construit (HubSpot + Claap).
    const hubspotSuggestionsPromise = generateHubspotSuggestions(
      row.hubspot_deal_id,
      contextPrompt,
      userId,
    ).catch((e) => {
      console.warn(
        `[clients/enrich/${clientId}] hubspot suggestions failed:`,
        e instanceof Error ? e.message : e,
      );
      return null;
    });

    // Health : ton des derniers meetings (signal du score, best-effort) et date
    // de fin de contrat (phase du compte), en parallèle du reste.
    const tonePromise = judgeRecentTone(ctx, userId).then(
      (tone) => ({ tone, error: null as string | null }),
      (e) => {
        console.warn(`[clients/enrich/${clientId}] tone judge failed:`, e instanceof Error ? e.message : e);
        return { tone: null, error: e instanceof Error ? e.message : String(e) };
      },
    );
    const dealFieldsPromise = fetchHubspotDealFields(row.hubspot_deal_id);

    const [msg, coachBrief, dealRecap, news, billing, hubspotSuggestions, toneRes, dealFields] = await Promise.all([
      fieldsPromise,
      briefPromise,
      recapPromise,
      newsPromise,
      billingPromise,
      hubspotSuggestionsPromise,
      tonePromise,
      dealFieldsPromise,
    ]);

    logUsage(userId, clientsModel, msg.usage.input_tokens, msg.usage.output_tokens, "clients_enrich_fields");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) {
      throw new Error("No tool_use block in Claude response");
    }

    // Re-enrich : la sortie IA (6 sections complètes) est fusionnée avec
    // l'existant. Les éditions manuelles survivent, sauf info plus récente.
    const parsed = parseClientFieldsFromClaude(toolBlock.input);
    const { merged } = mergeExtractedFields((row.fields_json ?? {}) as Partial<ClientFields>, parsed);

    const updatePayload: Record<string, unknown> = {
      fields_json: merged,
      enrichment_status: "done",
      enrichment_error: null,
      last_enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (coachBrief) {
      updatePayload.coach_brief = coachBrief;
      updatePayload.coach_brief_generated_at = new Date().toISOString();
    }
    if (dealRecap) {
      updatePayload.deal_recap = dealRecap;
    }
    if (news) {
      // Tri IA "important pour le compte" (best-effort), puis fusion avec les
      // news déjà connues (historique 12 mois, badge New).
      if (news.items.length > 0) {
        const ranked = await rankClientNews(news.items, {
          companyName: ctx.deal?.company?.name ?? ctx.deal?.name ?? "",
          userId,
          feature: "clients_news_rank",
        }).catch(() => ({ items: news.items, ignored: 0 }));
        news.items = ranked.items;
        news.ignored_count = ranked.ignored;
      }
      updatePayload.news = mergeNewsHistory((row.news as News | null) ?? null, news).news;
      updatePayload.last_news_run_at = new Date().toISOString();
    }
    if (billing) {
      updatePayload.billing = billing;
      updatePayload.billing_refreshed_at = new Date().toISOString();
    }
    // Suggestions HubSpot : persiste meme une liste vide (aucun champ manquant),
    // ca evite de re-generer a l'ouverture et marque que la passe a eu lieu.
    if (hubspotSuggestions) {
      updatePayload.hubspot_field_suggestions = hubspotSuggestions.suggestions;
    }

    // Persiste les recordings Claap découverts (non indexés dans
    // sales_coach_analyses) pour que la timeline UI les affiche. Sans ça
    // ils n'apparaissent que dans le prompt du recap, jamais sur la fiche.
    const discoveredRecordings = ctx.meetings
      .filter((m) => m.is_discovered)
      .map((m) => ({
        recording_id: m.recording_id,
        meeting_title: m.meeting_title,
        meeting_started_at: m.meeting_started_at,
        claap_url: m.claap_url ?? null,
        discovered_at: new Date().toISOString(),
      }));
    updatePayload.discovered_claap_recordings = discoveredRecordings;

    // Health + insights : règles sur les signaux du contexte qu'on vient de
    // charger, plus le ton jugé ci-dessus. Le score précédent (s'il existe) sert
    // à dériver la trend (up/down/stable).
    const previousScore =
      row.health && typeof row.health === "object" && "score" in row.health
        ? Number((row.health as { score?: unknown }).score)
        : null;
    const fieldsForInsights = (updatePayload.fields_json as Partial<ClientFields>) ?? {};
    const newsForHealth = (updatePayload.news as News | undefined) ?? (row.news as News | null) ?? null;
    const closedwonAt = (row.closedwon_at as string | null) ?? ctx.deal?.close_date ?? null;
    const contractEndDate = dealFields?.contract_end_date ?? null;
    const kickoff = fieldsForInsights.planning?.kickoff_envisage_le?.value;
    const health = computeHealth(ctx, Number.isFinite(previousScore) ? previousScore : null, {
      closedwonAt,
      kickoffDate: typeof kickoff === "string" ? kickoff : null,
      contractEndDate,
      news: newsForHealth,
      tone: toneRes.tone,
      toneError: toneRes.error,
    });
    // Reco IA (anglais, orientée closed-won), best-effort -> fallback règles EN.
    const insights =
      (await generateInsightsAI({
        ctx,
        health,
        fields: fieldsForInsights,
        news: (updatePayload.news as News | undefined) ?? null,
        closedwonAt,
        hubspotNextStep: dealFields?.hs_next_step ?? null,
        contractEndDate,
        previous: null,
        userId,
      }).catch((e) => {
        console.warn(
          `[clients/enrich/${clientId}] AI insights failed:`,
          e instanceof Error ? e.message : e,
        );
        return null;
      })) ?? computeInsights(ctx, health);

    // Phrase d'explication du score, ancrée sur les derniers échanges. Séquentiel
    // (après Promise.all) car elle a besoin du score/label déjà calculés.
    // Best-effort : un échec ne casse pas l'enrichissement.
    health.summary = await generateHealthSummary(ctx, health, userId).catch((e) => {
      console.warn(
        `[clients/enrich/${clientId}] health summary failed:`,
        e instanceof Error ? e.message : e,
      );
      return null;
    });

    // health_history : on append le snapshot courant (score + label + drivers
    // + computed_at) en gardant les 24 derniers (~ 2 ans si on cron-iser
    // mensuellement). Permet de tracer l'évolution du health sur la fiche.
    const existingHistory = Array.isArray(row.health_history) ? row.health_history : [];
    const newHistoryEntry = {
      score: health.score,
      label: health.label,
      drivers: health.drivers,
      computed_at: health.computed_at,
    };
    const trimmedHistory = [...existingHistory, newHistoryEntry].slice(-24);

    updatePayload.health = health;
    updatePayload.health_history = trimmedHistory;
    updatePayload.insights = insights;
    updatePayload.last_health_run_at = new Date().toISOString();

    const { error: updateErr } = await db.from("clients").update(updatePayload).eq("id", clientId);
    if (updateErr) {
      // supabase-js ne throw pas sur erreur DB : sans ce check, un PATCH qui
      // échoue laissait le statut bloqué sur "running" silencieusement (ok:true
      // renvoyé, aucune exception, aucun message). On la fait remonter au catch
      // pour basculer en "error" avec le message visible sur la fiche.
      throw new Error(`final update failed: ${updateErr.message}`);
    }

    // DM Slack à l'owner (best-effort) : la fiche est prête, il peut aller
    // compléter les infos manquantes. Idempotent via owner_notified_at — un
    // re-enrich ne re-DM pas. Un échec Slack ne fait jamais échouer
    // l'enrichissement. On AWAIT : en background function Netlify l'instance est
    // gelée dès le return, ce qui tuait un fire-and-forget en plein vol (DM
    // jamais envoyé en prod). Le .catch garde le caractère best-effort.
    await notifyOwnerOfEnrichedClient(clientId).catch((e) =>
      console.warn(
        `[clients/enrich/${clientId}] owner notify failed:`,
        e instanceof Error ? e.message : e,
      ),
    );

    return { ok: true };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[clients/enrich/${clientId}] error:`, errMsg);
    await db
      .from("clients")
      .update({
        enrichment_status: "error",
        enrichment_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);
    return { ok: false, error: errMsg };
  }
}

