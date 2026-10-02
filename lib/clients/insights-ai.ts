import { randomUUID } from "node:crypto";
import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE_EN } from "@/lib/no-em-dash";
import type { ClientEnrichmentContext } from "./context";
import { computeAccountPhase, PHASE_GUIDANCE } from "./lifecycle";
import type {
  ClientFields,
  Health,
  InsightAction,
  InsightHighlight,
  InsightSource,
  InsightSourceKind,
  Insights,
  News,
} from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Génération IA des "Next actions" (onglet Key insights) + des highlights de
// "What's new". Le scoring (health.ts) reste par règles ; ici on lit ce qui
// s'est passé RÉCEMMENT (45 derniers jours : meetings Claap, emails/notes
// HubSpot, messages Slack, news importantes) pour produire 1 à 3 actions
// concrètes, chacune avec un owner, une échéance et la source datée qui la
// déclenche. La phase du compte (onboarding / running / renewal) cadre les
// recos. Les actions déjà faites (30 j) sont passées au modèle pour ne pas les
// reproposer, et les actions encore ouvertes pour garder un plan stable d'une
// semaine à l'autre. Best-effort : null en cas d'échec, l'appelant retombe sur
// computeInsights (règles).

const INSIGHTS_MODEL = "claude-sonnet-4-6";
const RECENT_DAYS = 45;
const DONE_RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const SOURCE_KINDS: InsightSourceKind[] = ["claap", "hubspot", "slack", "news", "fiche"];

const sourceSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: SOURCE_KINDS },
    date: { type: ["string", "null"], description: "YYYY-MM-DD of the source, null if not dated" },
    label: {
      type: ["string", "null"],
      description: 'Short human label of the source, e.g. "Claap · QBR Q3", "Slack #lumen-retail", "HubSpot email", "HubSpot next step", "Les Echos"',
    },
  },
  required: ["kind"],
};

const CLIENT_INSIGHTS_TOOL = {
  name: "client_insights",
  description: "Return the 1 to 3 most important next actions for the account team, and up to 3 recent highlights.",
  input_schema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        description: "1 to 3 actions, most important first. Fewer is better than generic.",
        items: {
          type: "object",
          properties: {
            reuse_id: {
              type: ["string", "null"],
              description: "id of a CURRENT OPEN ACTION if this is the same action (keeps it stable), else null",
            },
            title: {
              type: "string",
              description: "Imperative, specific, max 9 words, names the person when known. E.g. \"Get the Teams app approved with Marc Leroy (IT)\"",
            },
            why: { type: "string", description: "Max 15 words: the concrete trigger from the data. No filler." },
            owner: { type: "string", enum: ["AM", "CS", "AE"] },
            due: { type: "string", enum: ["this_week", "next_2_weeks", "this_month"] },
            priority: { type: "string", enum: ["high", "medium"] },
            source: sourceSchema,
          },
          required: ["title", "why", "owner", "due", "priority", "source"],
        },
      },
      watch_points: {
        type: "array",
        description: "Up to 3 risks to watch on this account right now, max 8 words each, telegraphic (e.g. \"Champion on leave in December\"). Merge the fiche watch points with what recent activity shows. Drop risks that are resolved.",
        items: { type: "string" },
      },
      highlights: {
        type: "array",
        description: "Up to 3 most important facts from the RECENT activity (what changed lately), most recent first.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Telegraphic fact, max 12 words. E.g. \"HR wants a second cohort of 40 managers in January\"." },
            date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            source: sourceSchema,
          },
          required: ["text", "source"],
        },
      },
    },
    required: ["actions", "highlights", "watch_points"],
  },
};

function fieldValue(fields: Partial<ClientFields>, section: string, key: string): unknown {
  const s = (fields as Record<string, Record<string, { value?: unknown } | undefined>>)[section];
  return s?.[key]?.value ?? null;
}

function fmtContact(v: unknown): string {
  if (!v || typeof v !== "object") return "missing";
  const c = v as { name?: string; email?: string; role?: string };
  if (!c.name) return "missing";
  return [c.name, c.role ? `(${c.role})` : "", c.email ? `<${c.email}>` : ""].filter(Boolean).join(" ");
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "missing";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "missing";
  if (typeof v === "object") {
    const o = v as { enabled?: boolean; details?: string };
    if ("enabled" in o) return o.enabled ? `yes${o.details ? ` (${o.details})` : ""}` : "no";
    return JSON.stringify(v);
  }
  return String(v);
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "?";
}

function isRecent(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t <= days * DAY;
}

function parseSource(raw: unknown): InsightSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; date?: unknown; label?: unknown };
  const kind = SOURCE_KINDS.includes(r.kind as InsightSourceKind) ? (r.kind as InsightSourceKind) : "fiche";
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null;
  const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 80) : null;
  return { kind, date, label };
}

export type GenerateInsightsInput = {
  ctx: ClientEnrichmentContext;
  health: Health;
  fields: Partial<ClientFields>;
  news: News | null;
  closedwonAt: string | null;
  hubspotNextStep: string | null;
  contractEndDate: string | null;
  previous: Insights | null;
  userId: string | null;
};

export async function generateInsightsAI(input: GenerateInsightsInput): Promise<Insights | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { ctx, health, fields, news, previous, userId } = input;

  const model = await getModelPreference("clients", INSIGHTS_MODEL);
  const deal = ctx.deal;
  const company = deal?.company?.name ?? deal?.name ?? "the account";

  const kickoff = fieldValue(fields, "planning", "kickoff_envisage_le");
  const { phase, daysSinceSignature, daysToContractEnd } = computeAccountPhase({
    closedwonAt: input.closedwonAt,
    kickoffDate: typeof kickoff === "string" ? kickoff : null,
    contractEndDate: input.contractEndDate,
  });

  // ── Activité récente ────────────────────────────────────────────────────
  const meetingsDesc = [...(ctx.meetings ?? [])]
    .filter((m) => m.meeting_started_at)
    .sort((a, b) => new Date(b.meeting_started_at as string).getTime() - new Date(a.meeting_started_at as string).getTime());
  const recentMeetings = meetingsDesc.filter((m) => isRecent(m.meeting_started_at, RECENT_DAYS)).slice(0, 5);
  // Compte calme : on montre quand même les 2 derniers meetings pour le contexte.
  const meetingsForPrompt = recentMeetings.length > 0 ? recentMeetings : meetingsDesc.slice(0, 2);
  const meetingsBlock = meetingsForPrompt
    .map((m) => {
      const body = m.meeting_recap_summary?.slice(0, 1200) || (m.transcript_text ? `(transcript excerpt) ${m.transcript_text.slice(0, 1500)}` : "(no recap)");
      return `- [Claap ${day(m.meeting_started_at)}] ${m.meeting_title ?? "Meeting"}: ${body}`;
    })
    .join("\n");

  const engagementsBlock = (deal?.engagements ?? [])
    .filter((e) => isRecent(e.date, RECENT_DAYS))
    .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime())
    .slice(0, 15)
    .map((e) => {
      const dir = e.type === "email" && e.direction ? (e.direction === "in" ? " (from client)" : " (to client)") : "";
      return `- [HubSpot ${e.type}${dir} ${day(e.date)}] ${e.title ? `${e.title}: ` : ""}${(e.body ?? "").replace(/\s+/g, " ").slice(0, 400)}`;
    })
    .join("\n");

  const slackBlock = (ctx.slack ?? [])
    .filter((m) => isRecent(m.date, RECENT_DAYS))
    .slice(0, 30)
    .map((m) => `- [Slack #${m.channel} ${day(m.date)}] ${m.author}: ${m.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");

  const newsBlock = (news?.items ?? [])
    .filter((n) => (n.importance === "high" || n.importance === "medium") && isRecent(n.published_at ?? n.first_seen_at, 90))
    .slice(0, 5)
    .map((n) => `- [News ${day(n.published_at)} ${n.source_name ?? ""}] (${n.importance}) ${n.title}${n.why_it_matters ? ` => ${n.why_it_matters}` : ""}`)
    .join("\n");

  // ── Fiche ───────────────────────────────────────────────────────────────
  const keyFields = [
    `Signatory: ${fmtContact(fieldValue(fields, "general_info", "contact_signataire"))}`,
    `Primary HR: ${fmtContact(fieldValue(fields, "general_info", "contact_principal_rh"))}`,
    `Billing contact: ${fmtContact(fieldValue(fields, "general_info", "contact_facturation"))}`,
    `IT contact: ${fmtContact(fieldValue(fields, "general_info", "contact_it"))}`,
    `Coaching type: ${fmtScalar(fieldValue(fields, "program_scope", "type_coaching"))}`,
    `Program: ${fmtScalar(fieldValue(fields, "program_scope", "nom_programme"))}`,
    `Target population: ${fmtScalar(fieldValue(fields, "program_scope", "population_accompagnee"))}`,
    `Estimated coachees: ${fmtScalar(fieldValue(fields, "program_scope", "nb_coaches_estime"))}`,
    `Planned kickoff: ${fmtScalar(kickoff)}`,
    `Access: ${fmtScalar(fieldValue(fields, "org", "mode_acces"))}`,
    `Provisioning: ${fmtScalar(fieldValue(fields, "org", "provisioning"))}`,
    `Channel: ${fmtScalar(fieldValue(fields, "org", "canal"))} · app status: ${fmtScalar(fieldValue(fields, "org", "statut_app"))}`,
    `Security questionnaire: ${fmtScalar(fieldValue(fields, "org", "questionnaire_securite"))}`,
    `Expected CS follow-up: ${fmtScalar(fieldValue(fields, "planning", "suivi_cs_attendu"))}`,
    `Sales commitments: ${fmtScalar(fieldValue(fields, "planning", "engagements_sales"))}`,
    `Watch points: ${fmtScalar(fieldValue(fields, "history", "points_de_vigilance"))}`,
  ].join("\n");

  // ── Plan précédent ──────────────────────────────────────────────────────
  const prevActions = previous?.actions ?? [];
  const openPrev = prevActions.filter((a) => !a.done_at && a.id);
  const donePrev = prevActions.filter((a) => a.done_at && isRecent(a.done_at, DONE_RETENTION_DAYS));
  const openBlock = openPrev.map((a) => `- id=${a.id} · ${a.title}${a.why ? ` (${a.why})` : ""}`).join("\n");
  const doneBlock = donePrev.map((a) => `- ${a.title} (done ${day(a.done_at)})`).join("\n");

  const labelEn = health.label === "green" ? "healthy" : health.label === "yellow" ? "needs attention" : "at risk";
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You help the Account Manager (AM) and Customer Success (CS) of Coachello (B2B leadership coaching) manage the client **${company}**. Today is ${today}.

ACCOUNT
- Phase: ${PHASE_GUIDANCE[phase]}
- Signed: ${input.closedwonAt?.slice(0, 10) ?? "unknown"}${daysSinceSignature !== null ? ` (${daysSinceSignature} days ago)` : ""} · Amount: ${deal?.amount != null ? `${deal.amount}€` : "unknown"}
- Contract end: ${input.contractEndDate?.slice(0, 10) ?? "unknown"}${daysToContractEnd !== null ? ` (in ${daysToContractEnd} days)` : ""}
- Health: ${health.score}/100, ${labelEn}. Drivers: ${health.drivers?.join("; ") || "(none)"}
- HubSpot next step: ${input.hubspotNextStep?.trim() || "(none)"}

FICHE ("missing" = not captured yet)
${keyFields}

RECENT ACTIVITY (last ${RECENT_DAYS} days, most recent first)
Claap meetings:
${meetingsBlock || "(none)"}
HubSpot emails / notes / calls:
${engagementsBlock || "(none)"}
Slack:
${slackBlock || "(none)"}
Important company news:
${newsBlock || "(none)"}

CURRENT OPEN ACTIONS (from the previous refresh)
${openBlock || "(none)"}

ALREADY DONE (do not suggest these again)
${doneBlock || "(none)"}

Call the client_insights tool.
- actions: the 1 to 3 things that matter most NOW for this account, most important first. Each must be triggered by something concrete above, preferably RECENT (what was said in the last meetings, emails, Slack, or an important news), and cite it in "source" with its date. If the HubSpot next step is still relevant, it can be action 1 (source kind "hubspot", label "HubSpot next step"). Keep a current open action (same reuse_id) only if it is still relevant and not done. No generic advice ("send a check-in", "monitor adoption") unless the data shows a real reason. Name people when known.
- highlights: up to 3 facts from the recent activity that the team must know, with date and source. Not the actions again.
- watch_points: up to 3 short risks (max 8 words each).
Be very concise everywhere: this is read in 10 seconds. Write everything in English.

${NO_EM_DASH_RULE_EN}`;

  const client = anthropicClient({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
        tools: [CLIENT_INSIGHTS_TOOL],
        tool_choice: { type: "tool" as const, name: "client_insights" },
      }),
    { label: "clients/insights" },
  );

  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_insights");

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || !("input" in toolBlock)) return null;

  const raw = toolBlock.input as { actions?: unknown; highlights?: unknown; watch_points?: unknown };
  const openIds = new Set(openPrev.map((a) => a.id as string));
  const owners = new Set(["AM", "CS", "AE"]);
  const dues = new Set(["this_week", "next_2_weeks", "this_month"]);

  const actions: InsightAction[] = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a: Record<string, unknown>) => {
      const title = typeof a.title === "string" ? a.title.trim() : "";
      const reuse = typeof a.reuse_id === "string" && openIds.has(a.reuse_id) ? a.reuse_id : null;
      return {
        id: reuse ?? randomUUID(),
        title,
        why: typeof a.why === "string" && a.why.trim() ? a.why.trim() : undefined,
        owner: owners.has(a.owner as string) ? (a.owner as InsightAction["owner"]) : null,
        due: dues.has(a.due as string) ? (a.due as InsightAction["due"]) : null,
        priority: (a.priority === "high" ? "high" : "medium") as InsightAction["priority"],
        source: parseSource(a.source),
        done_at: null,
        done_by: null,
      };
    })
    .filter((a) => a.title)
    .slice(0, 3);

  const highlights: InsightHighlight[] = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .map((h: Record<string, unknown>) => ({
      text: typeof h.text === "string" ? h.text.trim() : "",
      date: typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(h.date) ? h.date.slice(0, 10) : null,
      source: parseSource(h.source),
    }))
    .filter((h) => h.text)
    .slice(0, 3);

  const watchPoints = (Array.isArray(raw.watch_points) ? raw.watch_points : [])
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim())
    .slice(0, 3);

  if (actions.length === 0 && highlights.length === 0) return null;

  // Les actions faites récemment restent stockées (masquées dans l'UI, "N done
  // this week") : c'est ce qui permet au prochain refresh de ne pas les reproposer.
  return { generated_at: new Date().toISOString(), actions: [...actions, ...donePrev], highlights, watch_points: watchPoints };
}
