import type { AgentSchedule } from "@/lib/agents/schedule";
import type { AgentColor } from "@/lib/agents/types";
import type { AudienceDestination } from "@/lib/agents/audience-label";

// Modèles de départ de la galerie "Start from a template" : ils pré-remplissent
// le builder (demande + planning + nom), le designer IA fait le reste. Seules
// des sources réellement branchées sur CoachelloAI sont sollicitées (pas
// d'agenda : aucun outil Calendar côté agent).

export type AgentTemplate = {
  key: string;
  name: string;
  emoji: string;
  color: AgentColor;
  category: string;
  tagline: string;
  request: string;
  schedule: AgentSchedule;
  /** Envoi à un groupe : destination pré-remplie dans le builder. */
  audience?: AudienceDestination;
};

const at = (frequency: AgentSchedule["frequency"], time: string, extra: Partial<AgentSchedule> = {}): AgentSchedule => ({
  frequency,
  days: [1],
  dayOfMonth: 1,
  time,
  timezone: "Europe/Paris",
  ...extra,
});

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: "pipeline-pulse",
    name: "Pipeline Pulse",
    emoji: "📈",
    color: "pink",
    category: "Sales",
    tagline: "Your open deals every Monday, with the next step for each",
    request:
      "Every Monday morning, give me a digest of my open deals: stage, amount, close date, last activity and a concrete next step for each. Highlight the deals that moved since last week and the ones closing this month.",
    schedule: at("weekly", "08:30"),
  },
  {
    key: "stale-deals",
    name: "Stale Deals Radar",
    emoji: "🔔",
    color: "amber",
    category: "Sales",
    tagline: "Alerts you when a deal goes quiet for 14 days",
    request:
      "Every weekday morning, alert me about my open deals with no activity (email, call, meeting) in the last 14 days, with the last touch point and a suggested next step. If there are none, don't send anything.",
    schedule: at("weekdays", "08:30"),
  },
  {
    key: "client-health",
    name: "Client Health Watch",
    emoji: "🩺",
    color: "green",
    category: "Account management",
    tagline: "Accounts at risk, why, and what to do this week",
    request:
      "Every Monday, list my client accounts whose health is yellow or red, the main reasons (last contact, meetings, tone), and the next action to take on each. End with the healthy accounts in one line.",
    schedule: at("weekly", "09:00"),
  },
  {
    key: "renewal-watch",
    name: "Renewal Watch",
    emoji: "⏰",
    color: "orange",
    category: "Account management",
    tagline: "Contracts ending in the next 90 days",
    request:
      "Every Monday, list my client accounts whose contract ends in the next 90 days: end date, health, billed revenue this year, last contact and the renewal next step. Sort by end date.",
    schedule: at("weekly", "09:00"),
  },
  {
    key: "meeting-digest",
    name: "Meeting Digest",
    emoji: "🎙️",
    color: "violet",
    category: "Sales",
    tagline: "This week's recorded meetings in 5 minutes",
    request:
      "Every Friday afternoon, summarize the client and prospect meetings I had this week on Claap: for each, the key takeaways, risks or objections, and the follow-ups I committed to.",
    schedule: at("weekly", "16:00", { days: [5] }),
  },
  {
    key: "market-news",
    name: "Market Radar",
    emoji: "📰",
    color: "slate",
    category: "Market",
    tagline: "Competitor and coaching market news, weekly",
    request:
      "Every Monday, the 5 most important news of the past week about our competitors (CoachHub, BetterUp, Ezra, Torch) and the corporate coaching market, with one line on why it matters for Coachello.",
    schedule: at("weekly", "08:00"),
  },
  {
    key: "revenue-checkin",
    name: "Revenue Check-in",
    emoji: "💶",
    color: "teal",
    category: "Finance",
    tagline: "Billed revenue vs target, every month",
    request:
      "On the 1st of every month, give the billed revenue vs target for the current quarter and the year, the split new vs renew, the top 5 clients by revenue this year, and the gap left to reach the yearly target.",
    schedule: at("monthly", "09:00"),
  },
  {
    key: "am-health-check",
    name: "AM Health Check",
    emoji: "🚦",
    color: "orange",
    category: "Group send",
    tagline: "Each AM gets their accounts at risk and what to do",
    request:
      "Every Monday morning, send each Account Manager the list of their client accounts whose health is red or yellow, with the main reasons (last contact, meetings, tone) and 2 or 3 concrete actions to improve each account this week. If an AM has no account at risk, don't send them anything.",
    schedule: at("weekly", "08:30"),
    audience: { type: "audience", groups: ["am"], include: [], exclude: [], personalize: true },
  },
  {
    key: "friday-wins",
    name: "Friday Wins",
    emoji: "🎉",
    color: "pink",
    category: "Group send",
    tagline: "The week's wins, sent to the whole team",
    request:
      "Every Friday afternoon, send the whole team the same short, upbeat message: the deals won this week (client, amount, owner), the new clients signed, and the billed revenue of the month vs target.",
    schedule: at("weekly", "16:30", { days: [5] }),
    audience: { type: "audience", groups: ["everyone"], include: [], exclude: [], personalize: false },
  },
];

export function findTemplate(key: string | null | undefined): AgentTemplate | undefined {
  return key ? AGENT_TEMPLATES.find((t) => t.key === key) : undefined;
}
