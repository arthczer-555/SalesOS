import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";
import { hubspotFetch, stripHtml } from "@/lib/hubspot";
import { withForcedTool } from "@/lib/models/compat";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { fetchDealCompany, fetchDealSlackMentions, fetchSalesCoachRecaps, slackDay } from "./context-sources";
import {
  CONTROLLABLE_LABELS,
  EXECUTION_AXES,
  LOSS_ANALYSIS_SCHEMA_VERSION,
  LOSS_REASONS,
  daysBetween,
  normalizeDeclaredReason,
  sanitizeLossOutput,
  stageBeforeLoss,
  withPhaseMetrics,
  type DealActivity,
  type LossAnalysis,
} from "./loss-analysis";

// Analyse de perte d'un deal closed lost : lit TOUT l'historique (emails
// entrants/sortants, meetings, calls, notes HubSpot, récaps Claap, Slack,
// dernier scoring KUNA) et cherche la vraie cause, la raison saisie dans
// HubSpot étant souvent vide ("-") ou un symptôme ("Ghosting"), puis dit quand
// et comment relancer le compte.
//
// Deux exécutants pour le MÊME contexte, le MÊME prompt et le MÊME schéma :
//  - le bouton "Analyze the loss" de l'app (API Anthropic, Background Function) ;
//  - le batch local scripts/loss-analysis-batch.mts (abonnement Claude via
//    `claude -p`), d'où le découpage prepareLossAnalysis / finalizeLossAnalysis.

// Préférence dédiée : `deals_analyze` (analyse approfondie) est réglée sur
// Haiku, trop faible pour un post-mortem.
const DEFAULT_MODEL = "claude-sonnet-5-5";
export const LOSS_MODEL_PREFERENCE = "deals_loss_analyze";
const CONTEXT_MAX_CHARS = 60_000;
const isInternal = (email: string) => /@coachello\./i.test(email);

export const lossAnalysisTool: Anthropic.Tool = {
  name: "loss_analysis",
  description: "Retourne l'analyse de perte structurée du deal",
  input_schema: {
    type: "object" as const,
    properties: {
      primary_reason: {
        type: "string",
        enum: [...LOSS_REASONS.map((r) => r.key), "unclear"],
        description: "Cause principale de la perte. \"unclear\" si les échanges ne permettent pas de trancher.",
      },
      secondary_reason: {
        type: "string",
        enum: [...LOSS_REASONS.map((r) => r.key), "none"],
      },
      controllable: { type: "string", enum: Object.keys(CONTROLLABLE_LABELS) },
      reason_explanation: {
        type: "string",
        description: "1 phrase factuelle : la vraie cause, avec le fait qui la prouve.",
      },
      hubspot_reason: {
        type: "string",
        description: "Raison à écrire dans HubSpot, 120 caractères max : libellé anglais de la raison principale, puis \" - \" et une précision courte.",
      },
      execution: {
        type: "array",
        description: "EXACTEMENT 6 entrées, une par axe.",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: EXECUTION_AXES.map((a) => a.key) },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            evidence: { type: "string", description: "1 phrase factuelle (dates, chiffres, citations courtes)." },
          },
          required: ["key", "rating", "evidence"],
        },
      },
      phases: {
        type: "array",
        description: "1 à 5 périodes contiguës, de la création du deal à sa perte, dans l'ordre.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["momentum", "stall", "silence"] },
            start: { type: "string", description: "YYYY-MM-DD" },
            end: { type: "string", description: "YYYY-MM-DD" },
            events: {
              type: "array",
              description: "1 à 3 événements datés marquants de la phase.",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", description: "YYYY-MM-DD" },
                  label: { type: "string", description: "6 mots max" },
                },
                required: ["date", "label"],
              },
            },
          },
          required: ["kind", "start", "end", "events"],
        },
      },
      chain: {
        type: "array",
        description: "2 à 4 étapes, du symptôme à la cause racine.",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["symptom", "cause", "deeper_cause", "root_cause"] },
            text: { type: "string" },
            proof: { type: "string", description: "Source et date : \"Email from Claire, 2026-06-18\", \"Claap meeting, 2026-04-15\", \"Slack #deals, 2026-06-19\"." },
          },
          required: ["level", "text", "proof"],
        },
      },
      reopen: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD strictement après aujourd'hui : date de la relance." },
          timing: { type: "string", description: "Pourquoi cette date : 1 phrase avec le fait daté qui la justifie." },
          who: { type: "string", description: "Qui contacter (nom et rôle), ou le rôle à trouver et par qui passer." },
          how: { type: "string", description: "Canal, angle d'accroche et ce qui a changé depuis. 2 phrases max." },
          watch_for: { type: "string", description: "Le signal qui justifierait de relancer plus tôt." },
        },
        required: ["date", "timing", "who", "how", "watch_for"],
      },
    },
    required: [
      "primary_reason", "secondary_reason", "controllable", "reason_explanation", "hubspot_reason",
      "execution", "phases", "chain", "reopen",
    ],
  },
};

export const LOSS_SYSTEM_PROMPT = `Tu es un expert en vente B2B pour Coachello (coaching professionnel : coaching humain et AI Role-Play). Tu fais le post-mortem d'un deal PERDU (closed lost) à partir de tout son historique : emails entrants et sortants, meetings, calls et notes HubSpot, récaps des meetings Claap, conversations Slack internes, dernier scoring KUNA.

Objectif : comprendre ce qui a VRAIMENT fait perdre ce deal. La raison saisie par l'AE dans HubSpot est souvent vide ou un symptôme ("Ghosting", "No answer") : cherche la cause derrière. Base chaque affirmation sur un échange précis, cite la date. N'invente jamais de fait, de date ni de citation.

primary_reason / secondary_reason, liste fixe :
- no_budget : pas de ligne budgétaire, budget coupé ou réaffecté
- priority_shift : projet dépriorisé, plus de projet
- competitor : un autre prestataire de coaching a été choisi
- alternative : solution interne ou autre format (formation, outil IA seul, LMS, "alternatives au coaching")
- product_fit : notre offre ne collait pas au besoin (format, langues, plateforme, fonctionnalités)
- price : trop cher face au budget ou à un concurrent
- no_access_to_power : le décideur n'a jamais été atteint, le champion n'a pas pu porter la décision
- champion_left : contact parti, muté, réorganisation qui a changé les interlocuteurs
- timing : bon besoin, mauvais moment, repoussé à plus tard
- procurement : passage en appel d'offres, achats bloquants, référencement
"unclear" pour primary_reason si les échanges ne permettent pas de trancher (deal sans historique, par exemple). Dans ce cas, dis-le dans reason_explanation, mets des notes d'exécution prudentes et une chaîne courte.

controllable : la perte dépendait-elle de notre exécution (ours) ou du contexte du prospect (theirs) ?

execution, 6 axes notés de 1 (très faible) à 5 (excellent) :
- qualification : budget, date de décision, process d'achat confirmés ?
- access_to_power : l'Economic Buyer a-t-il été identifié ET rencontré ?
- multithreading : combien de contacts actifs côté prospect, et pas seulement le champion ?
- business_case : douleur chiffrée, ROI partagé avec le décideur ?
- process_control : chaque échange finissait-il par une prochaine étape datée ?
- competitive_positioning : face aux concurrents ou au statu quo
evidence : 1 phrase factuelle avec date, chiffre ou citation courte.

phases : découpe la vie du deal en périodes contiguës (1 à 5) :
- momentum : les échanges circulent, meetings, réponses rapides
- stall : ralentissement, décision repoussée, plus de meeting
- silence : le prospect ne répond plus
La 1re commence à la date de création, la dernière finit à la date de passage en closed lost. Donne pour chaque phase 1 à 3 événements datés tirés du contexte. Les chiffres par phase (meetings, réponses, délais) sont calculés par l'application, ne les donne pas.

chain : du symptôme visible (symptom) à la cause racine (root_cause), 2 à 4 étapes, chacune avec sa preuve (source + date). La cause racine dit ce que NOUS aurions pu faire autrement quand c'est le cas.

reopen : un deal perdu vaut TOUJOURS une relance. La seule question est QUAND et COMMENT : ne conclus jamais qu'il ne faut pas relancer.
- date : date de relance, strictement après aujourd'hui. Cale-la sur le fait qui la justifie, selon la cause de la perte :
  - timing : la période donnée par le prospect ("pas avant septembre", "budget 2027"), un mois avant ;
  - no_budget, priority_shift : avant le prochain arbitrage budgétaire (en France, les budgets de l'année suivante se décident de septembre à novembre), ou 6 mois après la perte si un événement interne bloquait ;
  - competitor : 2 à 3 mois avant la fin probable du contrat du concurrent (souvent 12 mois après la perte) ;
  - champion_left : 3 à 6 mois après la perte, le temps que la nouvelle équipe s'installe ;
  - procurement : 2 à 3 mois avant le prochain appel d'offres ou la fin du référencement s'ils sont connus ;
  - deal perdu il y a plus d'un an : dans les 1 à 4 prochains mois, avec un motif concret de reprise de contact.
  N'utilise pas une date par défaut (1er janvier, 1er septembre) sans fait qui la justifie.
- timing : pourquoi cette date, 1 phrase avec le fait daté.
- who : la personne à contacter (nom et rôle) si elle est toujours pertinente ; sinon le rôle à trouver (ex. "le nouveau DRH groupe") et par qui passer.
- how : canal, angle d'accroche et ce qui a changé depuis. Coachello propose aujourd'hui du coaching humain ET de l'AI Role-Play (entraînement des managers avec un avatar IA) : un angle possible quand la perte venait du prix, du format ou du passage à l'échelle. 2 phrases max, concrètes.
- watch_for : le signal qui justifierait de relancer plus tôt (nomination, réorganisation, levée de fonds, nouveau programme managérial, ouverture d'un appel d'offres).

hubspot_reason : commence par le libellé anglais exact de la raison principale (No budget, Priority shift, Lost to a competitor, Alternative (in-house, other format), Product fit, Price, No access to power, Champion left or reorg, Timing, Procurement or RFP), puis " - " et une précision courte. 120 caractères max.

Rédige tous les textes dans la langue des échanges du deal (ne traduis pas), sauf le libellé de début de hubspot_reason.
Utilise l'outil loss_analysis pour répondre.
${NO_EM_DASH_RULE}`;

type Row = { id?: string; properties?: Record<string, string | null> };
type SearchRes = { results?: Row[] };

const dayOf = (ts: string | number | null | undefined): string => {
  if (ts === null || ts === undefined || ts === "") return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

// Nettoie récursivement les tirets longs de toutes les chaînes de la sortie IA.
function deepStrip<T>(v: T): T {
  if (typeof v === "string") return stripEmDashes(v) as T;
  if (Array.isArray(v)) return v.map(deepStrip) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepStrip(x)])) as T;
  }
  return v;
}

function engagementSearch(objectType: string, dealId: string, properties: string[], limit: number) {
  return hubspotFetch<SearchRes>(`/crm/v3/objects/${objectType}/search`, "POST", {
    filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
    sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    properties,
    limit,
  });
}

export type LossAnalysisResult =
  | { ok: true; analysis: LossAnalysis; model: string; ownerId: string | null }
  | { ok: false; error: string };

// Tout ce qui précède l'appel IA : contexte texte + faits déterministes
// nécessaires pour finaliser la sortie (bornes, activité, compteurs).
export interface PreparedLossAnalysis {
  dealId: string;
  context: string;
  bounds: { start: string; end: string };
  activity: DealActivity;
  sources: LossAnalysis["sources"];
  ownerId: string | null;
}

export async function prepareLossAnalysis(dealId: string): Promise<PreparedLossAnalysis> {
  const deal = await hubspotFetch<{ properties?: Record<string, string | null>; propertiesWithHistory?: { dealstage?: { value: string; timestamp: string }[] } }>(
    `/crm/v3/objects/deals/${dealId}?properties=dealname,amount,createdate,closedate,closed_lost_reason,hs_v2_date_entered_closedlost,hs_is_closed_lost,hubspot_owner_id,description,dealstage,deal_type&propertiesWithHistory=dealstage`,
  );
  const p = deal.properties ?? {};
  if (p.hs_is_closed_lost !== "true") throw new Error("This deal is not closed lost");

  const lostAt = p.hs_v2_date_entered_closedlost || p.closedate || new Date().toISOString();
  const createdAt = p.createdate || lostAt;
  const bounds = { start: dayOf(createdAt), end: dayOf(lostAt) };
  if (bounds.start > bounds.end) bounds.start = bounds.end;

  const [pipelinesRes, contactAssoc, emailsRes, meetingsRes, callsRes, notesRes, scoreRes, kunaRes, companyRes, ownerRes] =
    await Promise.allSettled([
      hubspotFetch<{ results?: { stages?: { id: string; label: string }[] }[] }>("/crm/v3/pipelines/deals"),
      hubspotFetch<{ results?: { id: string }[] }>(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
      engagementSearch("emails", dealId, [
        "hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hs_timestamp",
        "hs_email_from_email", "hs_email_from_firstname", "hs_email_from_lastname",
      ], 100),
      engagementSearch("meetings", dealId, ["hs_meeting_title", "hs_meeting_body", "hs_timestamp"], 50),
      engagementSearch("calls", dealId, ["hs_call_title", "hs_call_body", "hs_timestamp"], 50),
      engagementSearch("notes", dealId, ["hs_note_body", "hs_timestamp"], 50),
      db.from("deal_scores").select("score, reasoning, scored_at").eq("deal_id", dealId).maybeSingle(),
      // Best-effort : colonnes de la migration deal_scores_kuna.sql.
      db.from("deal_scores").select("kuna, committee").eq("deal_id", dealId).maybeSingle(),
      fetchDealCompany(dealId, p.dealname),
      p.hubspot_owner_id ? hubspotFetch<{ firstName?: string; lastName?: string }>(`/crm/v3/owners/${p.hubspot_owner_id}`) : Promise.resolve(null),
    ]);

  // Étapes : libellés + historique (date d'entrée de chaque étape).
  const stageLabels: Record<string, string> = {};
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) for (const s of pl.stages ?? []) stageLabels[s.id] = s.label;
  }
  const history = deal.propertiesWithHistory?.dealstage ?? [];
  const stageLine = [...history]
    .reverse()
    .filter((h, i, arr) => h.value && (i === 0 || arr[i - 1].value !== h.value))
    .map((h) => `${dayOf(h.timestamp)} ${stageLabels[h.value] ?? h.value}`)
    .join(" ; ");
  const before = stageBeforeLoss(history, p.dealstage ?? "");
  const lostAtStage = before ? `${stageLabels[before.stageId] ?? before.stageId} (${daysBetween(before.enteredAt, lostAt)} jours dans cette étape)` : "inconnue";

  // Contacts (10 max, suffisant pour cartographier le comité).
  let contactLines = "aucun";
  if (contactAssoc.status === "fulfilled") {
    const ids = (contactAssoc.value.results ?? []).slice(0, 10).map((r) => ({ id: r.id }));
    if (ids.length > 0) {
      try {
        const batch = await hubspotFetch<SearchRes>("/crm/v3/objects/contacts/batch/read", "POST", {
          inputs: ids,
          properties: ["firstname", "lastname", "jobtitle", "email"],
        });
        contactLines = (batch.results ?? [])
          .map((c) => {
            const cp = c.properties ?? {};
            return `${[cp.firstname, cp.lastname].filter(Boolean).join(" ")} - ${cp.jobtitle || "?"} <${cp.email || "?"}>`;
          })
          .join(" ; ") || "aucun";
      } catch { /* best-effort */ }
    }
  }

  // Échanges HubSpot, chronologiques. On garde aussi les timestamps bruts
  // pour recompter les métriques par phase (réponses, délais, meetings).
  type Item = { ts: number; head: string; body: string; kind: "email" | "other" };
  const items: Item[] = [];
  const activity: DealActivity = { inbound: [], outbound: [], meetingDays: [] };
  const meetingDays = new Set<string>();
  const rowsOf = (r: PromiseSettledResult<SearchRes>) => (r.status === "fulfilled" ? r.value.results ?? [] : []);
  const emails = rowsOf(emailsRes);
  for (const row of emails) {
    const ep = row.properties ?? {};
    const ts = ep.hs_timestamp ? Date.parse(ep.hs_timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const from = ep.hs_email_from_email?.trim() ?? "";
    const incoming = ep.hs_email_direction === "INCOMING_EMAIL" && !!from && !isInternal(from);
    if (incoming) activity.inbound.push(ts);
    else if (ep.hs_email_direction === "EMAIL") activity.outbound.push(ts);
    const name = [ep.hs_email_from_firstname, ep.hs_email_from_lastname].filter(Boolean).join(" ");
    const body = [ep.hs_email_subject?.trim(), ep.hs_email_text?.trim() || stripHtml(ep.hs_email_html ?? "")].filter(Boolean).join("\n");
    items.push({
      ts,
      kind: "email",
      head: incoming ? `EMAIL REÇU de ${name || from} <${from}>` : `EMAIL ENVOYÉ${from ? ` par ${from}` : ""}`,
      body,
    });
  }
  for (const row of rowsOf(meetingsRes)) {
    const mp = row.properties ?? {};
    const ts = mp.hs_timestamp ? Date.parse(mp.hs_timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    meetingDays.add(dayOf(ts));
    items.push({ ts, kind: "other", head: `MEETING ${mp.hs_meeting_title ?? ""}`.trim(), body: stripHtml(mp.hs_meeting_body ?? "") });
  }
  for (const row of rowsOf(callsRes)) {
    const cp = row.properties ?? {};
    const ts = cp.hs_timestamp ? Date.parse(cp.hs_timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    items.push({ ts, kind: "other", head: `CALL ${cp.hs_call_title ?? ""}`.trim(), body: stripHtml(cp.hs_call_body ?? "") });
  }
  for (const row of rowsOf(notesRes)) {
    const np = row.properties ?? {};
    const ts = np.hs_timestamp ? Date.parse(np.hs_timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    items.push({ ts, kind: "other", head: "NOTE", body: stripHtml(np.hs_note_body ?? "") });
  }
  items.sort((a, b) => a.ts - b.ts);

  const company = companyRes.status === "fulfilled" ? companyRes.value : { id: null, name: "" };
  // Slack : depuis un mois avant la création du deal jusqu'à aujourd'hui (les
  // mentions postérieures à la perte servent justement à dater la relance).
  const slackDays = daysBetween(createdAt, new Date().toISOString()) + 30;
  const [recapsRes, slackRes] = await Promise.allSettled([
    fetchSalesCoachRecaps(dealId, { companyId: company.id }),
    fetchDealSlackMentions(company.name, { days: slackDays, count: 20 }),
  ]);
  const recaps = recapsRes.status === "fulfilled" ? recapsRes.value : [];
  for (const m of recaps) if (m.meeting_started_at) meetingDays.add(dayOf(m.meeting_started_at));
  activity.meetingDays = [...meetingDays].filter(Boolean).sort();

  const slack = slackRes.status === "fulfilled" ? slackRes.value.messages : [];

  // Dernier scoring : ce que l'on croyait du deal avant sa perte.
  let scoreBlock = "Dernier scoring : aucun (deal jamais scoré).";
  const sc = scoreRes.status === "fulfilled" ? scoreRes.value.data : null;
  if (sc?.score) {
    const s = sc.score as { total?: number };
    const kn = kunaRes.status === "fulfilled" ? kunaRes.value.data : null;
    const kuna = Array.isArray(kn?.kuna) ? (kn.kuna as { key: string; status: string; evidence?: string }[]) : [];
    scoreBlock = [
      `Dernier scoring (${dayOf(sc.scored_at)}) : ${s.total ?? "?"}/100`,
      sc.reasoning ? `Reasoning :\n${sc.reasoning}` : null,
      kuna.length ? `KUNA :\n${kuna.map((k) => `- ${k.key} = ${k.status}${k.evidence ? ` (${k.evidence})` : ""}`).join("\n")}` : null,
    ].filter(Boolean).join("\n");
  }

  const owner = ownerRes.status === "fulfilled" && ownerRes.value ? [ownerRes.value.firstName, ownerRes.value.lastName].filter(Boolean).join(" ") : "";
  const header = [
    `Aujourd'hui : ${dayOf(Date.now())}`,
    `Deal : ${p.dealname ?? "?"} | Montant : ${p.amount ? `${Number(p.amount).toLocaleString("fr-FR")}€` : "?"} | Owner : ${owner || "?"}${p.deal_type ? ` | Type : ${p.deal_type}` : ""}`,
    `Créé le : ${bounds.start} | Passé en closed lost le : ${bounds.end} (${daysBetween(createdAt, lostAt)} jours de cycle)`,
    `Étape au moment de la perte : ${lostAtStage}`,
    `Raison déclarée par l'AE dans HubSpot : ${normalizeDeclaredReason(p.closed_lost_reason) ? `"${normalizeDeclaredReason(p.closed_lost_reason)}"` : "aucune"}`,
    `Historique des étapes (date d'entrée) : ${stageLine || "indisponible"}`,
    p.description ? `Description : ${p.description}` : null,
    `Contacts : ${contactLines}`,
    "",
    scoreBlock,
  ].filter((l) => l !== null).join("\n");

  const recapLines = recaps.map((m) => {
    const r = m.meeting_recap ?? {};
    const parts = [
      r.context ? `Contexte : ${r.context}` : null,
      r.need ? `Besoin : ${r.need}` : null,
      r.risks_competition ? `Risques/Concurrence : ${r.risks_competition}` : null,
      r.opportunities ? `Opportunités : ${r.opportunities}` : null,
      r.next_steps ? `Prochaines étapes : ${r.next_steps}` : null,
    ].filter(Boolean).join("\n");
    return `[${dayOf(m.meeting_started_at)} MEETING CLAAP] ${m.meeting_title ?? ""} (${m.meeting_kind ?? "?"})\n${parts}`;
  }).join("\n\n");
  const slackLines = slack.map((m) => `[${slackDay(m.timestamp)} #${m.channel}] ${m.text}`).join("\n\n");

  // Contexte borné : on resserre la taille de chaque échange plutôt que de
  // couper la fin (la fin d'un deal perdu est justement ce qui compte).
  let context = "";
  for (const cap of [1500, 700, 300]) {
    const exchanges = items
      .map((it) => `[${dayOf(it.ts)} ${it.head}]\n${it.body.slice(0, it.kind === "email" ? cap : cap * 2)}`)
      .join("\n\n");
    context = [
      header,
      `\nÉchanges HubSpot (ordre chronologique) :\n${exchanges || "aucun"}`,
      recapLines ? `\nRécaps Sales Coach (meetings Claap rattachés au deal ou à son entreprise) :\n${recapLines}` : null,
      slackLines ? `\nConversations Slack internes mentionnant l'entreprise :\n${slackLines}` : null,
    ].filter(Boolean).join("\n");
    if (context.length <= CONTEXT_MAX_CHARS) break;
  }
  context = context.slice(0, CONTEXT_MAX_CHARS);

  return {
    dealId,
    context,
    bounds,
    activity,
    sources: {
      emails: emails.length,
      meetings: activity.meetingDays.length,
      calls: rowsOf(callsRes).length,
      notes: rowsOf(notesRes).length,
      slack: slack.length,
    },
    ownerId: p.hubspot_owner_id ?? null,
  };
}

/** Sortie brute de l'IA (input du tool, ou structured_output de `claude -p`) -> analyse stockée. */
export function finalizeLossAnalysis(raw: unknown, prepared: PreparedLossAnalysis): LossAnalysis {
  const draft = sanitizeLossOutput(deepStrip(raw), prepared.bounds);
  return {
    schemaVersion: LOSS_ANALYSIS_SCHEMA_VERSION,
    ...draft,
    phases: withPhaseMetrics(draft.phases, prepared.activity),
    sources: prepared.sources,
  };
}

export async function runLossAnalysis(dealId: string, userId: string | null): Promise<LossAnalysisResult> {
  try {
    const [prepared, model] = await Promise.all([
      prepareLossAnalysis(dealId),
      getModelPreference(LOSS_MODEL_PREFERENCE, DEFAULT_MODEL),
    ]);

    const client = anthropicClient({ timeout: 600_000, creditContext: "Deals loss analysis" });
    const message = await client.messages.create(withForcedTool({
      model,
      max_tokens: 6000,
      system: LOSS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prepared.context }],
      tools: [lossAnalysisTool],
    }, "loss_analysis"));
    logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "deals_loss_analyze");

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) throw new Error("Invalid AI response");

    return { ok: true, analysis: finalizeLossAnalysis(toolBlock.input, prepared), model, ownerId: prepared.ownerId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[deals/loss-analysis/${dealId}] error:`, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Écrit une analyse terminée. reopen_date / owner_id sont écrits à part, en
 * best-effort : tant que la migration deals_next_move_reopen_chat.sql n'est pas
 * appliquée, l'analyse est quand même enregistrée.
 */
export async function persistLossAnalysis(
  dealId: string,
  analysis: LossAnalysis,
  model: string,
  ownerId: string | null,
): Promise<void> {
  const { error } = await db
    .from("deal_loss_analyses")
    .update({ status: "done", analysis, model, error_message: null, updated_at: new Date().toISOString() })
    .eq("deal_id", dealId);
  if (error) throw new Error(`deal_loss_analyses update: ${error.message}`);
  const { error: extraErr } = await db
    .from("deal_loss_analyses")
    .update({ reopen_date: analysis.reopen.date, owner_id: ownerId })
    .eq("deal_id", dealId);
  if (extraErr) console.warn("[deals/loss-analysis] reopen_date non persisté (migration ?):", extraErr.message);
}

/**
 * Runner background-safe : cycle de vie de la ligne deal_loss_analyses
 * (analyzing -> done/error) et écriture du résultat.
 */
export async function runAndPersistLossAnalysis(dealId: string, userId: string | null): Promise<{ ok: boolean; error?: string }> {
  await db
    .from("deal_loss_analyses")
    .update({ status: "analyzing", error_message: null, updated_at: new Date().toISOString() })
    .eq("deal_id", dealId);

  const result = await runLossAnalysis(dealId, userId);

  if (!result.ok) {
    await db
      .from("deal_loss_analyses")
      .update({ status: "error", error_message: result.error, updated_at: new Date().toISOString() })
      .eq("deal_id", dealId);
    return { ok: false, error: result.error };
  }

  await persistLossAnalysis(dealId, result.analysis, result.model, result.ownerId);
  return { ok: true };
}
