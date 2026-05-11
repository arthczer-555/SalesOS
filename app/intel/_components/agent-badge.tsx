"use client";

import * as React from "react";
import {
  UserCheck,
  Newspaper,
  Swords,
  TrendingUp,
  Banknote,
  Star,
  MessageSquare,
  Megaphone,
  Radar,
  type LucideIcon,
} from "lucide-react";
import type { AgentDef, AgentId } from "@/lib/intel-types";
import { AGENT_BY_ID, AGENT_CATEGORY_COLORS } from "@/lib/intel-agents";

const ICONS: Record<string, LucideIcon> = {
  UserCheck,
  Newspaper,
  Swords,
  TrendingUp,
  Banknote,
  Star,
  MessageSquare,
  Megaphone,
  Radar,
};

export function agentIcon(agent: AgentDef | null | undefined): LucideIcon {
  return (agent && ICONS[agent.iconName]) ?? Radar;
}

export function AgentBadge({ agentId, size = "sm" }: { agentId: AgentId | null | undefined; size?: "sm" | "md" }) {
  const agent = agentId ? AGENT_BY_ID[agentId] : null;
  const Icon = agentIcon(agent);
  const colors = agent ? AGENT_CATEGORY_COLORS[agent.category] : { fg: "#666", bg: "#f3f4f6", label: "—" };
  const label = agent?.name ?? "Inconnu";
  const padding = size === "md" ? "4px 10px" : "2px 8px";
  const fontSize = size === "md" ? 12 : 11;
  const iconSize = size === "md" ? 12 : 11;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding,
        borderRadius: 99,
        background: colors.bg,
        color: colors.fg,
        fontSize,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={iconSize} />
      {label}
    </span>
  );
}
