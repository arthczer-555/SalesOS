import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import { getModelPreference } from "../models/get-model-preference";
import { NO_EM_DASH_RULE_EN } from "@/lib/no-em-dash";
import type { ClientEnrichmentContext } from "./context";
import type { ClientFields, Health, Insights } from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Génération IA des "Prioritized actions" (la reco de la card Health). Le
// scoring (health.ts) et computeInsights (fallback) restent par règles ; ici on
// lit le contexte réel (deal, meetings récents, contacts connus/manquants,
// périmètre programme) pour produire des recos CONCRÈTES, en anglais, pensées
// pour un compte fraîchement closed-won (kickoff/onboarding, adoption, churn,
// upsell). Best-effort : si pas de clé ou échec, on renvoie null et l'appelant
// retombe sur computeInsights.

const INSIGHTS_MODEL = "claude-sonnet-4-6";

const CLIENT_INSIGHTS_TOOL = {
  name: "client_insights",
  description:
    "Return prioritized, concrete next actions and observations for a CS/AM taking over a freshly closed-won account.",
  input_schema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        description: "2 to 5 concrete, account-specific next actions, most important first.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short imperative action (max ~8 words)." },
            rationale: { type: "string", description: "One sentence grounded in the account context." },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["title", "priority"],
        },
      },
      observations: {
        type: "array",
        description: "Up to 3 short factual observations about the account.",
        items: { type: "string" },
      },
    },
    required: ["actions", "observations"],
  },
};

// Accès à la valeur d'un field (fields_json[section][key].value), ou null.
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
  return String(v);
}

export async function generateInsightsAI(
  ctx: ClientEnrichmentContext,
  health: Health,
  fields: Partial<ClientFields>,
  userId: string | null = null,
): Promise<Insights | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const model = await getModelPreference("clients", INSIGHTS_MODEL);

  const deal = ctx.deal;
  const company = deal?.company?.name ?? deal?.name ?? "the account";

  const recentMeetings = [...(ctx.meetings ?? [])]
    .filter((m) => m.meeting_started_at)
    .sort(
      (a, b) =>
        new Date(b.meeting_started_at as string).getTime() -
        new Date(a.meeting_started_at as string).getTime(),
    )
    .slice(0, 3)
    .map((m) => {
      const date = m.meeting_started_at?.slice(0, 10) ?? "?";
      const recap = m.meeting_recap_summary?.slice(0, 600) ?? "(no recap)";
      return `- ${date} - ${m.meeting_title ?? "Meeting"}: ${recap}`;
    })
    .join("\n");

  const keyFields = [
    `Signatory contact: ${fmtContact(fieldValue(fields, "general_info", "contact_signataire"))}`,
    `Primary HR contact: ${fmtContact(fieldValue(fields, "general_info", "contact_principal_rh"))}`,
    `Billing contact: ${fmtContact(fieldValue(fields, "general_info", "contact_facturation"))}`,
    `IT contact: ${fmtContact(fieldValue(fields, "general_info", "contact_it"))}`,
    `Coaching type: ${fmtScalar(fieldValue(fields, "program_scope", "type_coaching"))}`,
    `Program name: ${fmtScalar(fieldValue(fields, "program_scope", "nom_programme"))}`,
    `Target population: ${fmtScalar(fieldValue(fields, "program_scope", "population_accompagnee"))}`,
    `Planned kickoff date: ${fmtScalar(fieldValue(fields, "planning", "kickoff_envisage_le"))}`,
    `IT integration: ${fmtScalar(fieldValue(fields, "org", "integration_it"))}`,
    `Watch points: ${fmtScalar(fieldValue(fields, "history", "points_de_vigilance"))}`,
  ].join("\n");

  const labelEn =
    health.label === "green" ? "green (healthy)" : health.label === "yellow" ? "yellow (watch)" : "red (at risk)";

  const prompt = `You are helping a Customer Success / Account Manager who is taking over **${company}**, a deal that just closed won at Coachello (B2B coaching). Produce a short, actionable handover plan.

ACCOUNT
- Company: ${company}
- Deal amount: ${deal?.amount != null ? `${deal.amount}€` : "unknown"}
- Closed on: ${deal?.close_date?.slice(0, 10) ?? "unknown"}
- Owner (AE): ${deal?.owner_name ?? deal?.owner_email ?? "unknown"}

HEALTH
- Score: ${health.score}/100 - ${labelEn}
- Drivers: ${health.drivers?.join("; ") || "(none)"}

KEY FIELDS (from the enriched fiche - "missing" = not captured yet)
${keyFields}

RECENT MEETINGS
${recentMeetings || "(no recent analyzed meeting)"}

Call the client_insights tool. Give 2 to 5 prioritized, CONCRETE actions specific to THIS account's onboarding/handover - e.g. kicking off with the right contact, securing the billing or IT/SSO setup when a key contact is missing, driving early adoption, mitigating a churn risk surfaced in meetings, or an upsell opportunity. Each action needs a one-sentence rationale grounded in the data above. Add up to 3 factual observations. Do not restate the score. Be specific, avoid generic advice. Write everything in English.

${NO_EM_DASH_RULE_EN}`;

  const client = anthropicClient({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
        tools: [CLIENT_INSIGHTS_TOOL],
        tool_choice: { type: "tool" as const, name: "client_insights" },
      }),
    { label: "clients/insights" },
  );

  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_insights");

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || !("input" in toolBlock)) return null;

  const input = toolBlock.input as {
    actions?: Array<{ title?: unknown; rationale?: unknown; priority?: unknown }>;
    observations?: unknown;
  };

  const priorities = new Set(["high", "medium", "low"]);
  const actions = (Array.isArray(input.actions) ? input.actions : [])
    .map((a) => ({
      title: typeof a.title === "string" ? a.title.trim() : "",
      rationale: typeof a.rationale === "string" && a.rationale.trim() ? a.rationale.trim() : undefined,
      priority: (priorities.has(a.priority as string) ? a.priority : "medium") as "high" | "medium" | "low",
    }))
    .filter((a) => a.title)
    .slice(0, 5);

  const observations = (Array.isArray(input.observations) ? input.observations : [])
    .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    .map((o) => o.trim())
    .slice(0, 3);

  if (actions.length === 0 && observations.length === 0) return null;

  return { generated_at: new Date().toISOString(), actions, observations };
}
