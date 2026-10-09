/**
 * Audience d'un agent ("Send to a group", tout utilisateur) : groupes, normalisation,
 * calcul des membres et libellés. Isomorphe : l'éditeur calcule la liste des
 * destinataires en direct avec la même fonction que le dispatcher
 * (lib/agents/audience.ts), donc ce qu'on voit est ce qui sera envoyé.
 */

import { parseSalesRoles } from "@/lib/sales-roles";
import type { AgentDestination, AudienceGroup } from "./types";

export type AudienceDestination = Extract<AgentDestination, { type: "audience" }>;

export const AUDIENCE_GROUPS: { key: AudienceGroup; label: string; hint: string }[] = [
  { key: "everyone", label: "Everyone", hint: "Every CoachelloHQ account" },
  { key: "sales", label: "Sales team", hint: "Anyone with a sales role or the Sales flag" },
  { key: "ae", label: "AE", hint: "Account Executives" },
  { key: "am", label: "AM", hint: "Account Managers" },
  { key: "csm", label: "CSM", hint: "Customer Success" },
  { key: "admins", label: "Admins", hint: "CoachelloHQ admins" },
];
const GROUP_KEYS = AUDIENCE_GROUPS.map((g) => g.key);

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64))].slice(0, 300) : [];

export function normalizeAudience(raw: Record<string, unknown>): AudienceDestination {
  const groups = Array.isArray(raw.groups) ? GROUP_KEYS.filter((k) => (raw.groups as unknown[]).includes(k)) : [];
  const include = ids(raw.include);
  const exclude = ids(raw.exclude).filter((id) => !include.includes(id));
  return { type: "audience", groups, include, exclude, personalize: raw.personalize !== false };
}

export type AudienceUser = {
  id: string;
  name: string | null;
  email: string;
  is_admin?: boolean | null;
  is_sales?: boolean | null;
  sales_roles?: unknown;
};

function inGroup(u: AudienceUser, g: AudienceGroup): boolean {
  const roles = parseSalesRoles(u.sales_roles);
  switch (g) {
    case "everyone":
      return true;
    case "sales":
      return !!u.is_sales || roles.length > 0;
    case "admins":
      return !!u.is_admin;
    default:
      return roles.includes(g);
  }
}

/** Membres de l'audience : union des groupes, + personnes ajoutées, - exclues. */
export function matchAudience<T extends AudienceUser>(dest: AudienceDestination, users: T[]): T[] {
  const excluded = new Set(dest.exclude);
  const included = new Set(dest.include);
  return users
    .filter((u) => !excluded.has(u.id) && (included.has(u.id) || dest.groups.some((g) => inGroup(u, g))))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

/** La personne reçoit l'agent (même règle que le dispatcher). */
export function isAudienceMember(dest: AudienceDestination, user: AudienceUser): boolean {
  return matchAudience(dest, [user]).length > 0;
}

/** "Everyone", "AE & AM", "Sales team + 2", "AM except 1", "3 people". */
export function audienceLabel(dest: AudienceDestination, count?: number): string {
  const groupLabel = dest.groups.includes("everyone")
    ? "Everyone"
    : dest.groups.map((g) => AUDIENCE_GROUPS.find((x) => x.key === g)?.label ?? g).join(" & ");
  let label = groupLabel || (dest.include.length ? `${dest.include.length} ${dest.include.length > 1 ? "people" : "person"}` : "Nobody yet");
  if (groupLabel && dest.include.length) label += ` + ${dest.include.length}`;
  if (dest.exclude.length) label += ` except ${dest.exclude.length}`;
  if (count != null && (groupLabel || dest.exclude.length)) label += ` · ${count} ${count === 1 ? "person" : "people"}`;
  return label;
}
