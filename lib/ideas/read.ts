// Lecture de la boîte à idées, côté serveur.
//
// L'auteur est joint côté application plutôt que par un embed PostgREST
// (`ideas(users(...))`) : le volume est de l'ordre de la centaine de lignes, et
// deux requêtes simples restent lisibles sans dépendre du cache de schéma.

import { db } from "../db";
import { IDEAS_LIMIT, type Idea } from "./types";

/** Toutes les idées, la plus récente en premier, auteur résolu. */
export async function listIdeas(): Promise<Idea[]> {
  const { data: rows, error } = await db
    .from("ideas")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(IDEAS_LIMIT);

  if (error) throw new Error(`ideas: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: users } = await db.from("users").select("id, name, email").in("id", userIds);
  const byId = new Map((users ?? []).map((u) => [u.id as string, u]));

  return rows.map((r) => {
    const author = byId.get(r.user_id as string);
    return {
      id: r.id as string,
      content: r.content as string,
      createdAt: r.created_at as string,
      authorName: (author?.name as string | null) ?? null,
      authorEmail: (author?.email as string | null) ?? null,
    };
  });
}
