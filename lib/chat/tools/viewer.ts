/**
 * Qui pose la question à un outil : admin ou non, et sa clé rep (prénom
 * normalisé, comme dans le sheet revenue et AE Activity). Sert la règle
 * d'accès commune aux chiffres par commercial (get_sales_targets,
 * get_sales_activity) : un admin voit toute l'équipe, un non-admin ne voit
 * que lui-même, comme sur les dashboards.
 */

import { db } from "@/lib/db";
import { repKeyFromName } from "@/lib/ae-activity/revenue-sheet";
import type { ToolContext } from "./types";

export type Viewer = { isAdmin: boolean; repKey: string; name: string | null };

export async function viewer(ctx: ToolContext): Promise<Viewer> {
  const { data } = await db.from("users").select("name, email, is_admin").eq("id", ctx.userId).maybeSingle();
  const name = (data?.name as string | null) ?? null;
  return { isAdmin: !!data?.is_admin, repKey: repKeyFromName(name ?? (data?.email as string | undefined) ?? ""), name };
}
