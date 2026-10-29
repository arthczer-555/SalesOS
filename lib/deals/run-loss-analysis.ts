import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";
import { hubspotFetch, stripHtml } from "@/lib/hubspot";
import { searchSlackForCompany } from "@/lib/slack/search";
import { withForcedTool } from "@/lib/models/compat";
import { fetchSalesCoachRecaps } from "./run-analysis";
import {
  CONTROLLABLE_LABELS,
  EXECUTION_AXES,
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
// HubSpot étant souvent vide ("-") ou un symptôme ("Ghosting").
// Lancée uniquement au clic (jamais en cron), en Background Function.

const DEFAULT_MODEL = "claude-sonnet-5-5";
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
          verdict: { type: "string", enum: ["yes", "maybe", "no"] },
          date: { type: "string", description: "YYYY-MM-DD dans le futur, date de la tâche de relance. Vide si verdict = no." },
          trigger: { type: "string", description: "L'événement qui rendrait la relance pertinente (ou, si no, pourquoi ne pas relancer)." },
          way_in: { type: "string", description: "Par qui et comment revenir." },
        },
        required: ["verdict", "date", "trigger", "way_in"],
      },
    },
    required: [
      "primary_reason", "secondary_reason", "controllable", "reason_explanation", "hubspot_reason",
      "execution", "phases", "chain", "reopen",
    ],
  },
};

const SYSTEM_PROMPT = `Tu es un expert en vente B2B pour Coachello (coaching professionnel : coaching humain et AI Role-Play). Tu fais le post-mortem d'un deal PERDU (closed lost) à partir de tout son historique : emails entrants et sortants, meetings, calls et notes HubSpot, récaps des meetings Claap, conversations Slack internes, dernier scoring KUNA.

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

reopen : vaut-il le coup de relancer ce compte ? verdict yes / maybe / no. Si yes ou maybe : une date future réaliste pour la tâche de relance (ex. ouverture du budget de l'année suivante), le déclencheur et le chemin d'accès (qui, comment). Si no : date vide, trigger explique pourquoi.

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
  | { ok: true; analysis: LossAnalysis; model: string }
  | { ok: false; error: string };

export async function runLossAnalysis(dealId: string, userId: string | null): Promise<LossAnalysisResult> {
  try {
    const deal = await hubspotFetch<{ properties?: Record<string, string | null>; propertiesWithHistory?: { dealstage?: { value: string; timestamp: string }[] } }>(
      `/crm/v3/objects/deals/${dealId}?properties=dealname,amount,createdate,closedate,closed_lost_reason,hs_v2_date_entered_closedlost,hs_is_closed_lost,hubspot_owner_id,description,dealstage,deal_type&propertiesWithHistory=dealstage`,
    );
    const p = deal.properties ?? {};
    if (p.hs_is_closed_lost !== "true") throw new Error("This deal is not closed lost");

    const lostAt = p.hs_v2_date_entered_closedlost || p.closedate || new Date().toISOString();
    const createdAt = p.createdate || lostAt;
    const bounds = { start: dayOf(createdAt), end: dayOf(lostAt) };
    if (bounds.start > bounds.end) bounds.start = bounds.end;

    const [pipelinesRes, contactAssoc, emailsRes, meetingsRes, callsRes, notesRes, scoreRes, kunaRes, modelRes, recapsRes, ownerRes] =
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
        db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
        fetchSalesCoachRecaps(dealId),
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

    const recaps = recapsRes.status === "fulfilled" ? recapsRes.value : [];
    for (const m of recaps) if (m.meeting_started_at) meetingDays.add(dayOf(m.meeting_started_at));
    activity.meetingDays = [...meetingDays].filter(Boolean).sort();

    const companyName = (p.dealname ?? "").replace(/\s*[-–|/].*$/, "").trim();
    const slack = companyName ? await searchSlackForCompany(companyName).catch(() => []) : [];

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

    let model = DEFAULT_MODEL;
    if (modelRes.status === "fulfilled") {
      const entry = (modelRes.value as { data: { content: string } | null }).data;
      if (entry?.content) {
        try {
          model = (JSON.parse(entry.content) as Record<string, string>).deals_analyze ?? DEFAULT_MODEL;
        } catch { /* garde le modèle par défaut */ }
      }
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
    const slackLines = slack.map((m) => `[${dayOf(parseFloat(m.timestamp) * 1000)} #${m.channel}] ${m.text}`).join("\n\n");

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
        recapLines ? `\nRécaps Sales Coach (meetings Claap rattachés au deal) :\n${recapLines}` : null,
        slackLines ? `\nConversations Slack internes mentionnant l'entreprise :\n${slackLines}` : null,
      ].filter(Boolean).join("\n");
      if (context.length <= CONTEXT_MAX_CHARS) break;
    }
    context = context.slice(0, CONTEXT_MAX_CHARS);

    const client = anthropicClient({ timeout: 600_000, creditContext: "Deals loss analysis" });
    const message = await client.messages.create(withForcedTool({
      model,
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: context }],
      tools: [lossAnalysisTool],
    }, "loss_analysis"));
    logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "deals_loss_analyze");

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) throw new Error("Invalid AI response");

    const draft = sanitizeLossOutput(deepStrip(toolBlock.input), bounds);
    const analysis: LossAnalysis = {
      ...draft,
      phases: withPhaseMetrics(draft.phases, activity),
      sources: {
        emails: emails.length,
        meetings: activity.meetingDays.length,
        calls: rowsOf(callsRes).length,
        notes: rowsOf(notesRes).length,
        slack: slack.length,
      },
    };
    return { ok: true, analysis, model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[deals/loss-analysis/${dealId}] error:`, msg);
    return { ok: false, error: msg };
  }
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

  await db
    .from("deal_loss_analyses")
    .update({
      status: "done",
      analysis: result.analysis,
      model: result.model,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("deal_id", dealId);
  return { ok: true };
}
