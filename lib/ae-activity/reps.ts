// ────────────────────────────────────────────────────────────────────────
// Reps dynamiques : la liste des personnes suivies est pilotée par la table
// `users`, sans modification de code quand l'équipe bouge.
//
// Deux flags DISTINCTS, à ne pas confondre :
//   - `is_sales`    : reçoit le deal digest Slack (toggle Sales de l'admin).
//   - `sales_roles` : porte un objectif de revenu (ae / am / csm), donc a un
//                     dashboard perso et une ligne dans les vues manager.
//
// Un CSM peut porter un objectif Renew sans devoir recevoir le digest des
// deals. D'où le OU ci-dessous plutôt qu'un unique `is_sales`.
// ────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { repAccent } from "@/lib/design/tokens";
import { parseSalesRoles, type SalesRole } from "@/lib/sales-roles";

export type SalesRep = {
  userId: string;
  ownerId: string; // hubspot_owner_id
  name: string;
  email: string | null;
  slackUserId: string | null;
  accent: string;
  roles: SalesRole[];
  isSales: boolean; // reçoit le digest
};

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  hubspot_owner_id: string | null;
  slack_user_id: string | null;
  is_sales: boolean | null;
  sales_roles?: unknown;
};

const BASE_COLS = "id, name, email, hubspot_owner_id, slack_user_id, is_sales";

export async function listSalesReps(): Promise<SalesRep[]> {
  // `sales_roles` peut ne pas encore exister (migrations appliquées à la main) :
  // on retombe alors sur le seul is_sales.
  let rows: UserRow[] = [];
  const withRoles = await db
    .from("users")
    .select(`${BASE_COLS}, sales_roles`)
    .not("hubspot_owner_id", "is", null);

  if (!withRoles.error && withRoles.data) {
    rows = withRoles.data as UserRow[];
  } else {
    const base = await db.from("users").select(BASE_COLS).not("hubspot_owner_id", "is", null);
    if (base.error || !base.data) {
      console.warn("[ae-activity] listSalesReps failed:", base.error?.message);
      return [];
    }
    rows = base.data as UserRow[];
  }

  return rows
    .map((u) => ({ u, roles: parseSalesRoles(u.sales_roles) }))
    .filter(({ u, roles }) => !!u.hubspot_owner_id && (u.is_sales === true || roles.length > 0))
    .map(({ u, roles }) => ({
      userId: u.id,
      ownerId: String(u.hubspot_owner_id),
      name: u.name || u.email || "Sales",
      email: u.email ?? null,
      slackUserId: u.slack_user_id ?? null,
      accent: repAccent(u.name || u.email),
      roles,
      isSales: u.is_sales === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
