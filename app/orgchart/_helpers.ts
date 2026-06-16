import { COLORS } from "@/lib/design/tokens";
import type { Level, DecisionRole, RelationshipStatus } from "@/lib/orgchart/types";

export const LEVEL_LABELS: Record<Level, string> = {
  c_level: "C-level",
  vp: "VP",
  director: "Director",
  manager: "Manager",
  ic: "IC",
  unknown: "—",
};

export const DECISION_ROLE_LABELS: Record<DecisionRole, string> = {
  decision_maker: "Decision maker",
  champion: "Champion",
  influencer: "Influencer",
  gatekeeper: "Gatekeeper",
  user: "User",
  unknown: "—",
};

export const RELATIONSHIP_LABELS: Record<RelationshipStatus, string> = {
  engaged: "Engaged",
  cold: "Cold",
  never_contacted: "Never contacted",
  left: "Left company",
  unknown: "—",
};

type BadgeStyle = { fg: string; bg: string };

export function levelBadge(level: Level | null | undefined): BadgeStyle {
  switch (level) {
    case "c_level":
      return { fg: COLORS.brand, bg: COLORS.brandTint };
    case "vp":
      return { fg: "#9d174d", bg: "#fce7f3" };
    case "director":
      return { fg: COLORS.info, bg: COLORS.infoBg };
    case "manager":
      return { fg: "#1e40af", bg: "#dbeafe" };
    case "ic":
      return { fg: COLORS.ink2, bg: COLORS.bgSoft };
    default:
      return { fg: COLORS.ink3, bg: COLORS.bgSoft };
  }
}

export function decisionRoleBadge(role: DecisionRole | null | undefined): BadgeStyle {
  switch (role) {
    case "decision_maker":
      return { fg: COLORS.err, bg: COLORS.errBg };
    case "champion":
      return { fg: COLORS.ok, bg: COLORS.okBg };
    case "influencer":
      return { fg: COLORS.info, bg: COLORS.infoBg };
    case "gatekeeper":
      return { fg: COLORS.warn, bg: COLORS.warnBg };
    case "user":
      return { fg: COLORS.ink2, bg: COLORS.bgSoft };
    default:
      return { fg: COLORS.ink3, bg: COLORS.bgSoft };
  }
}

export function relationshipBadge(status: RelationshipStatus | null | undefined): BadgeStyle {
  switch (status) {
    case "engaged":
      return { fg: COLORS.ok, bg: COLORS.okBg };
    case "cold":
      return { fg: "#1e40af", bg: "#dbeafe" };
    case "never_contacted":
      return { fg: COLORS.ink2, bg: COLORS.bgSoft };
    case "left":
      return { fg: COLORS.err, bg: COLORS.errBg };
    default:
      return { fg: COLORS.ink3, bg: COLORS.bgSoft };
  }
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Nom d'affichage propre : si le "nom" est en réalité un email (contacts
// HubSpot sans prénom/nom), on dérive un libellé lisible depuis la partie locale
// ("natasha.vaz@..." -> "Natasha Vaz").
export function displayName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "No name";
  if (n.includes("@")) {
    const local = n.split("@")[0];
    const words = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (words.length) return words.join(" ");
  }
  return n;
}

export function initials(name: string): string {
  const parts = displayName(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
