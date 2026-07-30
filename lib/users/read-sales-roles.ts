// Lecture serveur des champs sales d'un utilisateur.
//
// Les migrations de ce projet sont appliquées à la main dans le SQL Editor
// Supabase : il existe donc une fenêtre où le code déployé connaît déjà
// `users.sales_roles` alors que la colonne n'existe pas encore. Sans repli, le
// select entier échoue et la page se vide sans explication. On dégrade sur
// "aucun rôle" plutôt que de casser.

import { db } from "@/lib/db";
import { parseSalesRoles, type SalesRole } from "@/lib/sales-roles";

export type UserSalesFields = {
  hubspotOwnerId: string | null;
  isSales: boolean;
  roles: SalesRole[];
};

export async function readUserSalesFields(userId: string): Promise<UserSalesFields> {
  const withRoles = await db
    .from("users")
    .select("hubspot_owner_id, is_sales, sales_roles")
    .eq("id", userId)
    .maybeSingle();

  if (!withRoles.error && withRoles.data) {
    return {
      hubspotOwnerId: withRoles.data.hubspot_owner_id ?? null,
      isSales: withRoles.data.is_sales ?? false,
      roles: parseSalesRoles(withRoles.data.sales_roles),
    };
  }

  const base = await db
    .from("users")
    .select("hubspot_owner_id, is_sales")
    .eq("id", userId)
    .maybeSingle();

  return {
    hubspotOwnerId: base.data?.hubspot_owner_id ?? null,
    isSales: base.data?.is_sales ?? false,
    roles: [],
  };
}

/**
 * Rôles de plusieurs utilisateurs d'un coup (listes admin). Map vide si la
 * colonne n'existe pas encore.
 */
export async function readSalesRolesMap(): Promise<Map<string, SalesRole[]>> {
  const out = new Map<string, SalesRole[]>();
  const res = await db.from("users").select("id, sales_roles");
  if (res.error || !res.data) return out;
  for (const row of res.data as Array<{ id: string; sales_roles: unknown }>) {
    out.set(row.id, parseSalesRoles(row.sales_roles));
  }
  return out;
}
