/**
 * Catalogue des sources qu'un agent peut lire. Une source = une famille
 * d'outils de CoachelloAI (lib/chat/tools/). Isomorphe : la correspondance
 * source -> outils réels vit côté serveur dans lib/agents/tools.ts.
 *
 * Les descriptions sont lues par le designer IA pour choisir les sources :
 * elles disent ce que la source contient vraiment, pas un slogan.
 */

import type { LogoKey } from "@/app/_components/tool-logo";

export type AgentSourceKey =
  | "hubspot"
  | "clients"
  | "revenue"
  | "claap"
  | "slack"
  | "gmail"
  | "drive"
  | "notion"
  | "linkedin"
  | "web";

export type AgentSourceDef = {
  key: AgentSourceKey;
  label: string;
  description: string;
  logo: LogoKey;
  /** Avertissement affiché quand la source est cochée (coût, connexion...). */
  note?: string;
};

export const AGENT_SOURCES: AgentSourceDef[] = [
  {
    key: "hubspot",
    label: "HubSpot CRM",
    description:
      "Deals, pipeline, contacts, companies and their activity (emails, calls, meetings, notes). Sales activity per salesperson by week, month or quarter, same numbers as the AE Activity dashboard: calls (connected, cold), emails sent, meetings declared in #1y-new-meetings with their acquisition channel, inbound leads, deals opened, won and lost.",
    logo: "hubspot",
  },
  {
    key: "clients",
    label: "Client accounts",
    description: "CoachelloHQ client files: account tier (Tier 1 = most important), health score, programs (one per program: status Not started / Set up / POC / Live / Turned off, Human or AI Role-Play, tripartite, objective, risk), contacts, goals, next actions, key dates (signature, kickoff, last contact, next billing, contract start and end), billed revenue, Claap meetings of the account, live HubSpot deal fields (qualification, champion, budget, contract duration, billing). Can list the accounts whose contract ends in the next N days (renewals).",
    logo: "coachello",
  },
  {
    key: "revenue",
    label: "Revenue sheet",
    description:
      "Every invoice with its date, client, amount and AE/AM/CSM (any period: week, month, quarter), billed revenue per client and per year, target vs billed per client (year and quarters, YoY status: expansion, churn), target vs billed per salesperson, the 2026 forecast and weekly sales review, company KPIs vs targets. Source of truth for revenue, not HubSpot.",
    logo: "sheets",
  },
  {
    key: "claap",
    label: "Claap meetings",
    description: "Recorded meetings with prospects and clients, and their transcripts.",
    logo: "claap",
  },
  {
    key: "slack",
    label: "Slack",
    description:
      "List channels, read a channel over a date range and search messages in Coachello's Slack. Knows the key channels: #1a-new-incoming-leads (inbound leads), #1y-new-meetings (sales meetings booked), #2x-booking-notifications (coaching session bookings). Counted in code: inbound leads (posted, qualified = validated by the team, awaiting review) and coaching bookings (new, orientation calls, reschedules, cancellations, internal coaches apart).",
    logo: "slack",
  },
  {
    key: "gmail",
    label: "Gmail",
    description: "Your own inbox: search and read emails.",
    logo: "gmail",
    note: "Reads your inbox. Requires Gmail connected in Settings.",
  },
  {
    key: "drive",
    label: "Google Drive",
    description: "Search and read Google Docs, Sheets and files shared with Coachello.",
    logo: "drive",
  },
  {
    key: "notion",
    label: "Coachello knowledge",
    description: "Notion knowledge base: programs, pricing, playbooks, positioning, processes.",
    logo: "notion",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    description: "People and company profiles, posts and job openings.",
    logo: "linkedin",
    note: "Paid data provider, slower. Use only when it adds real value.",
  },
  {
    key: "web",
    label: "Web search",
    description: "News and public web pages (companies, competitors, market).",
    logo: "web",
  },
];

export const AGENT_SOURCE_KEYS = AGENT_SOURCES.map((s) => s.key);

export function isAgentSourceKey(v: unknown): v is AgentSourceKey {
  return typeof v === "string" && (AGENT_SOURCE_KEYS as string[]).includes(v);
}

export function sourceDef(key: AgentSourceKey): AgentSourceDef {
  return AGENT_SOURCES.find((s) => s.key === key) ?? AGENT_SOURCES[0];
}

export function normalizeSources(input: unknown): AgentSourceKey[] {
  if (!Array.isArray(input)) return [];
  // Ordre du catalogue, pas celui de la saisie : affichage stable.
  const set = new Set(input.filter(isAgentSourceKey));
  return AGENT_SOURCE_KEYS.filter((k) => set.has(k));
}
