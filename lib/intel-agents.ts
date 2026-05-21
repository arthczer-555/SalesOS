// ── Configuration statique de l'agent Market Intel ────────────────────────
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
