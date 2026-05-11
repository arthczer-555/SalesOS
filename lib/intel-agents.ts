// ── Configuration statique des 8 agents Market Intel ────────────────────────
// Identité fixe en code, runtime state en DB (table intel_agent_runs).

import type { AgentDef, AgentId } from "./intel-types";

export const AGENTS: AgentDef[] = [
  {
    id: "job-change",
    name: "Job Change",
    description:
      "Détecte les changements de poste sur les profils ICP monitorés (Radar Netrows). Signal poussé en temps réel via webhook.",
    category: "first-party",
    status: "active",
    estimatedCreditsPerRun: "0 (push)",
    signalTypes: ["job_change", "job_change_icp_match"],
    runEndpoint: null,
    iconName: "UserCheck",
    configurable: false,
  },
  {
    id: "company-news",
    name: "Company News",
    description:
      "Posts LinkedIn des entreprises cibles : nominations, lancements, annonces produit.",
    category: "social",
    status: "active",
    estimatedCreditsPerRun: "1 / société",
    signalTypes: ["linkedin_post", "nomination"],
    runEndpoint: "/api/linkedin/weekly-scan",
    iconName: "Newspaper",
    configurable: true,
  },
  {
    id: "competitor-activity",
    name: "Competitor Activity",
    description:
      "Veille sur les AM/SDR/AE des concurrents : leurs likes et posts, en particulier ceux qui touchent vos prospects.",
    category: "social",
    status: "inactive",
    estimatedCreditsPerRun: "1-2 / profil",
    signalTypes: ["competitor_engagement", "content"],
    runEndpoint: "/api/intel/agents/competitor-activity/run",
    iconName: "Swords",
    configurable: true,
  },
  {
    id: "hiring-spike",
    name: "Hiring Spike",
    description:
      "Variations soudaines d'effectifs et ouvertures de rôles ICP (DRH, L&D, People Ops).",
    category: "first-party",
    status: "partial",
    estimatedCreditsPerRun: "0 push + 1 / société",
    signalTypes: ["hiring"],
    runEndpoint: "/api/intel/agents/hiring-spike/run",
    iconName: "TrendingUp",
    configurable: true,
  },
  {
    id: "funding-expansion",
    name: "Funding & Expansion",
    description:
      "Levées de fonds, M&A, ouvertures de bureaux et restructurations détectées via web (Tavily).",
    category: "web",
    status: "inactive",
    estimatedCreditsPerRun: "hors crédits Netrows",
    signalTypes: ["funding", "expansion", "restructuring"],
    runEndpoint: "/api/intel/agents/funding/run",
    iconName: "Banknote",
    configurable: true,
  },
  {
    id: "champion-tracker",
    name: "Champion Tracker",
    description:
      "Anciens champions HubSpot (deals closed-won/lost) qui changent de boîte → opportunité de re-pitch.",
    category: "first-party",
    status: "inactive",
    estimatedCreditsPerRun: "0 push",
    signalTypes: ["champion_change", "job_change"],
    runEndpoint: "/api/intel/agents/champion-tracker/run",
    iconName: "Star",
    configurable: true,
  },
  {
    id: "intent-content",
    name: "Intent / Content",
    description:
      "Posts d'employés ICP qui parlent de douleurs ou de mots-clés cibles (coaching, L&D, burnout, etc.).",
    category: "social",
    status: "partial",
    estimatedCreditsPerRun: "1 / keyword",
    signalTypes: ["content", "linkedin_post"],
    runEndpoint: "/api/intel/agents/intent-content/run",
    iconName: "MessageSquare",
    configurable: true,
  },
  {
    id: "ads-activity",
    name: "Ads Activity",
    description:
      "Pubs LinkedIn actives d'une cible — souvent un signal d'investissement marketing et budget ouvert.",
    category: "social",
    status: "inactive",
    estimatedCreditsPerRun: "1 / société",
    signalTypes: ["ads"],
    runEndpoint: "/api/intel/agents/ads/run",
    iconName: "Megaphone",
    configurable: false,
  },
];

export const AGENT_BY_ID: Record<AgentId, AgentDef> = AGENTS.reduce(
  (acc, agent) => {
    acc[agent.id] = agent;
    return acc;
  },
  {} as Record<AgentId, AgentDef>
);

export function getAgent(id: string | null | undefined): AgentDef | null {
  if (!id) return null;
  return AGENT_BY_ID[id as AgentId] ?? null;
}

export const AGENT_CATEGORY_COLORS = {
  "first-party": { fg: "#059669", bg: "#ecfdf5", label: "First-party" },
  social: { fg: "#b45309", bg: "#fef3c7", label: "Social" },
  web: { fg: "#1d4ed8", bg: "#dbeafe", label: "Web" },
} as const;
