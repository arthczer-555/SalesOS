import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";

const DEFAULT_ANALYZE_MODEL = "claude-sonnet-4-6";

export const analyzeTool: Anthropic.Tool = {
  name: "deal_analysis",
  description: "Retourne l'analyse structurée du deal",
  input_schema: {
    type: "object" as const,
    properties: {
      synthese: { type: "string", description: "2-3 phrases résumant l'état réel du deal" },
      riskLevel: { type: "string", enum: ["Faible", "Moyen", "Élevé"] },
      dynamique: {
        type: "object",
        properties: {
          momentum: { type: "string", enum: ["En accélération", "Stable", "En perte de vitesse"] },
          analyse: { type: "string", description: "Analyse précise de la dynamique" },
        },
        required: ["momentum", "analyse"],
      },
      qualification: {
        type: "object",
        properties: {
          budget: { type: "string" },
          authority: { type: "string" },
          need: { type: "string" },
          timeline: { type: "string" },
          fit: { type: "string" },
        },
        required: ["budget", "authority", "need", "timeline", "fit"],
      },
      signaux: {
        type: "object",
        properties: {
          positifs: { type: "array", items: { type: "string" } },
          negatifs: { type: "array", items: { type: "string" } },
        },
        required: ["positifs", "negatifs"],
      },
      risques: {
        type: "array",
        items: {
          type: "object",
          properties: {
            risque: { type: "string" },
            severite: { type: "string", enum: ["Faible", "Moyen", "Élevé"] },
          },
          required: ["risque", "severite"],
        },
      },
      scoreInsight: { type: "string", description: "Lecture du score IA" },
      prochaines_etapes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            priorite: { type: "string", enum: ["Urgent", "Moyen", "Faible"] },
            impact: { type: "string" },
          },
          required: ["action", "priorite", "impact"],
        },
      },
      evenements_cles: {
        type: "array",
        description:
          "Événements datés marquants qui retracent le parcours du deal, extraits des échanges (devis/proposition envoyé, échange ou réunion important, objection majeure, relance décisive, décision/engagement du prospect…). Uniquement ceux dont la date est identifiable dans le contexte.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date de l'événement au format YYYY-MM-DD" },
            label: { type: "string", description: "Titre court (ex: 'Devis envoyé', 'Échange important')" },
            type: {
              type: "string",
              enum: ["devis", "contrat", "echange_important", "objection", "relance", "decision", "reunion", "autre"],
            },
            description: { type: "string", description: "1 phrase de contexte factuelle" },
          },
          required: ["date", "label", "type", "description"],
        },
      },
    },
    required: ["synthese", "riskLevel", "dynamique", "qualification", "signaux", "risques", "scoreInsight", "prochaines_etapes", "evenements_cles"],
  },
};

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot réponse non-JSON (${ct}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function slackGet(path: string, params?: Record<string, string>) {
  const url = new URL(`https://slack.com/api${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  return data.ok ? data : null;
}

async function searchSlackForCompany(companyName: string): Promise<{ channel: string; text: string; user: string; timestamp: string }[]> {
  if (!companyName || !process.env.SLACK_BOT_TOKEN) return [];
  const messages: { channel: string; text: string; user: string; timestamp: string }[] = [];

  try {
    const userToken = process.env.SLACK_USER_TOKEN;
    if (userToken) {
      const url = new URL("https://slack.com/api/search.messages");
      url.searchParams.set("query", companyName);
      url.searchParams.set("count", "20");
      url.searchParams.set("sort", "timestamp");
      url.searchParams.set("sort_dir", "desc");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const data = await res.json();
      if (data.ok) {
        for (const m of (data.messages?.matches ?? []).slice(0, 20)) {
          messages.push({
            channel: m.channel?.name ?? "",
            text: m.text?.slice(0, 500) ?? "",
            user: m.user ?? m.username ?? "",
            timestamp: m.ts ?? "",
          });
        }
        return messages;
      }
    }

    const channels: { name: string; id: string }[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string> = { limit: "200", types: "public_channel,private_channel" };
      if (cursor) params.cursor = cursor;
      const data = await slackGet("/conversations.list", params);
      if (!data) break;
      channels.push(...(data.channels ?? []));
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const keyword = companyName.toLowerCase();
    for (const ch of channels) {
      if (messages.length >= 20) break;
      const history = await slackGet("/conversations.history", { channel: ch.id, limit: "200" });
      if (!history) continue;
      const matched = (history.messages ?? []).filter((m: { text: string }) =>
        m.text?.toLowerCase().includes(keyword)
      );
      for (const m of matched.slice(0, 5)) {
        messages.push({
          channel: ch.name,
          text: m.text?.slice(0, 500) ?? "",
          user: m.user ?? "",
          timestamp: m.ts ?? "",
        });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

export type DealAnalysisResult =
  | { ok: true; analysis: unknown; model: string }
  | { ok: false; error: string };

export async function runDealAnalysis(dealId: string, userId: string | null): Promise<DealAnalysisResult> {
  try {
    const DEAL_PROPS = [
      "dealname", "dealstage", "amount", "closedate",
      "hubspot_owner_id", "hs_lastmodifieddate", "notes_last_contacted",
      "deal_type", "description",
    ];

    const [dealData, contactAssoc, engagementAssoc] = await Promise.allSettled([
      hubspot(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS.join(",")}`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
      hubspot(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    let contactLines = "";
    if (contactAssoc.status === "fulfilled") {
      const ids: string[] = (contactAssoc.value?.results ?? []).slice(0, 5).map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        const details = await Promise.allSettled(
          ids.map((cid) => hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle,email`))
        );
        contactLines = details
          .filter((c) => c.status === "fulfilled")
          .map((c) => {
            const cp = (c as PromiseFulfilledResult<{ properties: Record<string, string> }>).value.properties;
            return `${cp.firstname ?? ""} ${cp.lastname ?? ""} - ${cp.jobtitle ?? "?"}`.trim();
          })
          .join(", ");
      }
    }

    let engagementLines = "";
    let scoreContext = "Score IA : non disponible (deal non scoré)";
    let analyzeModel = DEFAULT_ANALYZE_MODEL;

    const engIds: string[] = engagementAssoc.status === "fulfilled"
      ? (engagementAssoc.value?.results ?? []).map((r: { id: string }) => r.id)
      : [];

    const dealCompanyName = p.dealname?.replace(/\s*[-–|/].*$/, "").trim() ?? "";

    const [engResult, scoreResult, modelResult, slackResult] = await Promise.allSettled([
      engIds.length > 0
        ? Promise.allSettled([
            hubspot("/crm/v3/objects/engagements/batch/read", "POST", {
              inputs: engIds.map((id) => ({ id })),
              properties: ["hs_engagement_type", "hs_body_preview", "hs_createdate"],
            }),
            hubspot("/crm/v3/objects/meetings/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
              limit: 15,
            }),
            hubspot("/crm/v3/objects/calls/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
              limit: 15,
            }),
            hubspot("/crm/v3/objects/notes/search", "POST", {
              filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
              properties: ["hs_note_body", "hs_timestamp"],
              limit: 10,
            }),
          ])
        : Promise.resolve(null),
      process.env.SUPABASE_URL
        ? db.from("deal_scores").select("score, reasoning, next_action, scored_at").eq("deal_id", dealId).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
      searchSlackForCompany(dealCompanyName),
    ]);

    if (engResult.status === "fulfilled" && engResult.value) {
      const [batchRes, meetingsRes, callsRes, notesRes] = engResult.value as PromiseSettledResult<{ results: { properties: Record<string, string> }[] }>[];

      const engLines = batchRes.status === "fulfilled"
        ? (batchRes.value.results ?? [])
          .map((e) => {
            const ep = e.properties ?? {};
            const type = ep.hs_engagement_type ?? "Activité";
            const date = ep.hs_createdate ? new Date(ep.hs_createdate).toLocaleDateString("fr-FR") : "";
            const body = stripHtml(ep.hs_body_preview ?? "").slice(0, 500);
            return body ? `[${type} ${date}] ${body}` : "";
          })
          .filter(Boolean)
        : [];

      const meetingLines = meetingsRes.status === "fulfilled"
        ? (meetingsRes.value.results ?? [])
          .map((m) => {
            const mp = m.properties ?? {};
            const date = mp.hs_timestamp ? new Date(mp.hs_timestamp).toLocaleDateString("fr-FR") : "";
            const title = mp.hs_meeting_title ?? "Réunion";
            const body = stripHtml(mp.hs_meeting_body ?? "").slice(0, 2000);
            return body ? `[MEETING ${date}] ${title}\n${body}` : "";
          })
          .filter(Boolean)
        : [];

      const callLines = callsRes.status === "fulfilled"
        ? (callsRes.value.results ?? [])
          .map((c) => {
            const cp = c.properties ?? {};
            const date = cp.hs_timestamp ? new Date(cp.hs_timestamp).toLocaleDateString("fr-FR") : "";
            const title = cp.hs_call_title ?? "Appel";
            const body = stripHtml(cp.hs_call_body ?? "").slice(0, 2000);
            return body ? `[CALL ${date}] ${title}\n${body}` : "";
          })
          .filter(Boolean)
        : [];

      const noteLines = notesRes.status === "fulfilled"
        ? (notesRes.value.results ?? [])
          .map((n) => {
            const np = n.properties ?? {};
            const date = np.hs_timestamp ? new Date(np.hs_timestamp).toLocaleDateString("fr-FR") : "";
            const body = stripHtml(np.hs_note_body ?? "").slice(0, 3000);
            return body ? `[NOTE ${date}] ${body}` : "";
          })
          .filter(Boolean)
        : [];

      engagementLines = [...meetingLines, ...callLines, ...noteLines, ...engLines].join("\n\n");
    }

    if (scoreResult.status === "fulfilled") {
      const cached = (scoreResult.value as { data: { score: unknown; reasoning: string; next_action: string } | null })?.data;
      if (cached?.score) {
        const s = cached.score as { total: number; components: { name: string; earned: number; max: number }[]; reliability: number };
        const componentLines = (s.components ?? [])
          .map((c) => `  - ${c.name}: ${c.earned}/${c.max}`)
          .join("\n");
        scoreContext = [
          `Score IA : ${s.total}/100`,
          `Détail :\n${componentLines}`,
          cached.reasoning ? `Reasoning : ${cached.reasoning}` : null,
          cached.next_action ? `Next action suggérée : ${cached.next_action}` : null,
        ].filter(Boolean).join("\n");
      }
    }

    if (modelResult.status === "fulfilled") {
      const entry = (modelResult.value as { data: { content: string } | null })?.data;
      if (entry?.content) {
        analyzeModel = (JSON.parse(entry.content) as Record<string, string>).deals_analyze ?? DEFAULT_ANALYZE_MODEL;
      }
    }

    const slackMessages = slackResult.status === "fulfilled" ? slackResult.value : [];
    const slackSection = slackMessages.length > 0
      ? "\n\nConversations Slack internes mentionnant cette entreprise :\n" +
        slackMessages.map((m: { channel: string; text: string; timestamp: string }) => {
          const date = m.timestamp ? new Date(parseFloat(m.timestamp) * 1000).toLocaleDateString("fr-FR") : "";
          return `[#${m.channel} ${date}] ${m.text}`;
        }).join("\n\n")
      : "";

    const contextBlock = [
      `Deal : ${p.dealname ?? "?"} | Stage : ${p.dealstage ?? "?"} | Montant : ${p.amount ? `${parseFloat(p.amount).toLocaleString("fr-FR")}€` : "?"}`,
      `Clôture : ${p.closedate ? new Date(p.closedate).toLocaleDateString("fr-FR") : "?"}`,
      p.description ? `Description : ${p.description}` : null,
      contactLines ? `Contacts : ${contactLines}` : "Contacts : aucun",
      `\n${scoreContext}`,
      engagementLines ? `\nTous les échanges HubSpot :\n${engagementLines}` : "\nÉchanges : aucun enregistré",
      slackSection || null,
    ].filter(Boolean).join("\n").slice(0, 14000);

    const client = new Anthropic({ timeout: 600_000 });
    const message = await client.messages.create({
      model: analyzeModel,
      max_tokens: 4000,
      system: `Tu es un expert en vente B2B pour Coachello (coaching professionnel).
Analyse ce deal commercial en profondeur à partir de TOUTES les données disponibles (score IA, échanges HubSpot, conversations Slack internes, contacts, contexte).
Sois hyper précis et factuel - base chaque analyse sur des éléments concrets tirés des échanges.
Les messages Slack sont des conversations internes de l'équipe Coachello - ils contiennent souvent des insights précieux sur l'avancement du deal, les blocages, et le contexte commercial.
Ne mentionne jamais la probabilité HubSpot du stage - c'est une valeur automatique non pertinente. Raisonne uniquement sur la dynamique réelle (échanges, signaux, engagement).
Identifie aussi les ÉVÉNEMENTS CLÉS datés qui retracent le parcours du deal (devis/proposition envoyé, échange ou réunion important, objection majeure, relance décisive, décision ou engagement du prospect…). Pour chacun : une date au format YYYY-MM-DD (convertis depuis les dates DD/MM/YYYY du contexte), un label court, un type, une phrase de contexte. N'invente JAMAIS de date : si un événement ne peut pas être daté à partir du contexte, ne l'inclus pas.
Utilise l'outil deal_analysis pour retourner ton analyse.`,
      messages: [{ role: "user", content: contextBlock }],
      tools: [analyzeTool],
      tool_choice: { type: "tool" as const, name: "deal_analysis" },
    });

    logUsage(userId, analyzeModel, message.usage.input_tokens, message.usage.output_tokens, "deals_analyze");
    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) throw new Error("Réponse IA invalide");

    return { ok: true, analysis: toolBlock.input, model: analyzeModel };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[deals/analyze/${dealId}] error:`, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Background-safe runner: handles the deal_analyses row lifecycle (analyzing -> done/error)
 * and writes the result. Returns a status flag for the BG function caller.
 */
export async function runAndPersistDealAnalysis(dealId: string, userId: string | null): Promise<{ ok: boolean; error?: string }> {
  await db
    .from("deal_analyses")
    .update({ status: "analyzing", error_message: null, updated_at: new Date().toISOString() })
    .eq("deal_id", dealId);

  const result = await runDealAnalysis(dealId, userId);

  if (!result.ok) {
    await db
      .from("deal_analyses")
      .update({
        status: "error",
        error_message: result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId);
    return { ok: false, error: result.error };
  }

  await db
    .from("deal_analyses")
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
