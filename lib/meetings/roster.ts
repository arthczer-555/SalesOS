// L'équipe Coachello (table users), pour reconnaître l'auteur d'une annonce,
// l'owner, les admins et les collègues cités.

import { db } from "@/lib/db";

export interface TeamMember {
  userId: string;
  name: string;
  email: string | null;
  slackUserId: string | null;
  hubspotOwnerId: string | null;
  isAdmin: boolean;
  salesRoles: string[];
}

export async function loadRoster(): Promise<TeamMember[]> {
  const { data, error } = await db.from("users").select("id, name, email, slack_user_id, hubspot_owner_id, is_admin, sales_roles");
  if (error) throw new Error(`users read failed: ${error.message}`);
  return ((data ?? []) as { id: string; name: string | null; email: string | null; slack_user_id: string | null; hubspot_owner_id: string | null; is_admin: boolean | null; sales_roles: string[] | null }[])
    .filter((u) => u.name)
    .map((u) => ({
      userId: u.id,
      name: (u.name ?? "").replace(/\s+/g, " ").trim(),
      email: u.email,
      slackUserId: u.slack_user_id,
      hubspotOwnerId: u.hubspot_owner_id,
      isAdmin: !!u.is_admin,
      salesRoles: u.sales_roles ?? [],
    }));
}

export const memberBySlackId = (roster: TeamMember[], slackId: string | null | undefined) =>
  slackId ? roster.find((m) => m.slackUserId === slackId) ?? null : null;

export const memberByOwnerId = (roster: TeamMember[], ownerId: string | null | undefined) =>
  ownerId ? roster.find((m) => m.hubspotOwnerId === ownerId) ?? null : null;

export const adminSlackIds = (roster: TeamMember[]) => roster.filter((m) => m.isAdmin && m.slackUserId).map((m) => m.slackUserId as string);

/** Emails internes (Coachello) : jamais pris pour un prospect. */
export function isInternalEmail(email: string | null | undefined, roster: TeamMember[]): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (e.endsWith("@coachello.io") || e.endsWith("@coachello.com")) return true;
  return roster.some((m) => (m.email ?? "").toLowerCase() === e);
}
