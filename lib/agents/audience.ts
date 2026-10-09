/**
 * Résolution serveur de l'audience d'un agent, à chaque échéance : un nouvel
 * AM coché dans l'admin, ou un nouveau compte pour "Everyone", reçoit l'agent
 * sans qu'on le modifie. Même calcul que l'éditeur (matchAudience).
 */

import { db } from "@/lib/db";
import { matchAudience, type AudienceDestination, type AudienceUser } from "./audience-label";

/** Comptes CoachelloHQ avec leurs rôles. Repli sans `sales_roles` si la colonne manque. */
export async function loadAudienceUsers(): Promise<AudienceUser[]> {
  const full = await db.from("users").select("id, name, email, is_admin, is_sales, sales_roles");
  if (!full.error) return (full.data ?? []) as AudienceUser[];
  const base = await db.from("users").select("id, name, email, is_admin, is_sales");
  return (base.data ?? []) as AudienceUser[];
}

/** Un seul compte, mêmes champs et même repli que loadAudienceUsers. */
export async function loadAudienceUser(userId: string): Promise<AudienceUser | null> {
  const full = await db.from("users").select("id, name, email, is_admin, is_sales, sales_roles").eq("id", userId).maybeSingle<AudienceUser>();
  if (!full.error) return full.data ?? null;
  const base = await db.from("users").select("id, name, email, is_admin, is_sales").eq("id", userId).maybeSingle<AudienceUser>();
  return base.data ?? null;
}

export async function resolveAudience(dest: AudienceDestination): Promise<{ id: string; name: string | null; email: string }[]> {
  const users = await loadAudienceUsers();
  return matchAudience(dest, users).map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
