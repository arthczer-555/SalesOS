// Construction du dashboard personnel d'un utilisateur donné.
//
// Partagé entre /api/me/dashboard (soi-même) et /api/admin/user-dashboard
// (un admin qui regarde le dashboard d'un collègue) : les deux doivent rendre
// exactement la même chose, sinon la vue « voir comme » ment.

import { db } from "@/lib/db";
import { readUserSalesFields } from "@/lib/users/read-sales-roles";
import type { MeDashboardResponse, RepSnapshot } from "@/lib/ae-activity/types";

export async function buildMeDashboard(userId: string): Promise<MeDashboardResponse> {
  const { roles, hubspotOwnerId: ownerId, isSales } = await readUserSalesFields(userId);

  // Porter un rôle suffit : un CSM a un objectif Renew sans recevoir le digest
  // (is_sales). Sans owner HubSpot en revanche, aucun snapshot n'est rattachable.
  const hasDashboard = isSales || roles.length > 0;
  if (!hasDashboard || !ownerId) {
    return { rep: null, roles, isSales: hasDashboard, hasOwnerId: ownerId != null, refreshedAt: null };
  }

  const { data: snap } = await db
    .from("ae_activity_snapshots")
    .select("payload, refreshed_at")
    .eq("rep_owner_id", ownerId)
    .maybeSingle();

  return {
    rep: (snap?.payload as RepSnapshot | undefined) ?? null,
    roles,
    isSales: true,
    hasOwnerId: true,
    refreshedAt: (snap?.refreshed_at as string | undefined) ?? null,
  };
}

export type DashboardUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isSales: boolean;
  roles: string[];
  hasSnapshot: boolean;
};

/**
 * Utilisateurs consultables depuis la vue « voir comme » : tout le monde, y
 * compris ceux sans rôle — c'est justement utile de vérifier ce que voit un
 * collaborateur hors équipe sales.
 */
export async function listDashboardUsers(): Promise<DashboardUser[]> {
  const [usersRes, snapsRes] = await Promise.all([
    db.from("users").select("id, name, email, is_admin, is_sales, sales_roles, hubspot_owner_id").order("name"),
    db.from("ae_activity_snapshots").select("rep_owner_id"),
  ]);

  // La colonne sales_roles peut manquer (migration manuelle) : on retombe sur
  // une liste sans rôles plutôt que sur une page vide.
  const rows = usersRes.error
    ? ((await db.from("users").select("id, name, email, is_admin, is_sales, hubspot_owner_id").order("name")).data ?? [])
    : (usersRes.data ?? []);

  const withSnapshot = new Set(
    (snapsRes.data ?? []).map((r) => String((r as { rep_owner_id: string }).rep_owner_id)),
  );

  return (rows as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id),
    name: (u.name as string) || (u.email as string) || "—",
    email: (u.email as string) ?? "",
    isAdmin: u.is_admin === true,
    isSales: u.is_sales === true,
    roles: Array.isArray(u.sales_roles) ? (u.sales_roles as string[]) : [],
    hasSnapshot: u.hubspot_owner_id != null && withSnapshot.has(String(u.hubspot_owner_id)),
  }));
}
