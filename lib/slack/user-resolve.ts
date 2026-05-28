import { db } from "@/lib/db";
import { getUserInfo } from "./api";

type ResolvedUser = { id: string; email: string; name: string | null };

/**
 * Cherche un user unique sur une colonne donnée (comparaison insensible à la
 * casse). Ne renvoie un résultat que s'il est unique : en cas d'homonyme on
 * préfère refuser plutôt que d'attribuer le message au mauvais user.
 */
async function matchSingle(
  column: "slack_user_id" | "slack_display_name" | "email" | "name",
  value: string,
): Promise<ResolvedUser | null> {
  const { data, error } = await db
    .from("users")
    .select("id, email, name")
    .ilike(column, value)
    .limit(2);
  if (error) {
    console.error("[slack/user-resolve] db query failed", { column, value, error });
    return null;
  }
  if (data && data.length === 1) return data[0] as ResolvedUser;
  if (data && data.length > 1) {
    console.error("[slack/user-resolve] multiple users match", { column, value });
  }
  return null;
}

/**
 * Résout un Slack user_id vers un DbUser SalesOS.
 *
 *  0. Cache : si `users.slack_user_id` correspond déjà, on renvoie directement
 *     SANS appeler Slack `users.info`. C'est le chemin nominal une fois le user
 *     vu une première fois — il supprime la dépendance à un appel live qui
 *     échouait par intermittence et provoquait de faux "pas reconnu".
 *  1. Sinon (1er contact), on interroge `users.info` puis on matche en cascade :
 *     a. `slack_display_name` (configuré dans /settings) comparé au `display_name`
 *        ET au `real_name` Slack — les deux car le user peut avoir saisi son nom
 *        complet alors que son display_name Slack est un surnom.
 *     b. Email Slack ↔ `users.email`.
 *     c. `users.name` ↔ `display_name`/`real_name` — fallback pour les comptes
 *        qui n'ont jamais rempli `slack_display_name`.
 *     Sur match, on mémorise `slack_user_id` pour que les prochains messages
 *     passent par le cache (étape 0).
 *
 * Chaque étape exige un match unique (cf. matchSingle).
 */
export async function resolveSlackUser(slackUserId: string): Promise<ResolvedUser | null> {
  const cached = await matchSingle("slack_user_id", slackUserId);
  if (cached) return cached;

  let info: Awaited<ReturnType<typeof getUserInfo>>;
  try {
    info = await getUserInfo(slackUserId);
  } catch (e) {
    console.error("[slack/user-resolve] users.info failed", { slackUserId, error: e });
    return null;
  }

  const displayName = info.profile?.display_name?.trim() || null;
  const realName = info.profile?.real_name?.trim() || info.real_name?.trim() || null;
  const email = info.profile?.email?.toLowerCase() ?? null;
  const names = [...new Set([displayName, realName].filter((n): n is string => !!n))];

  let hit: ResolvedUser | null = null;
  for (const name of names) {
    hit = await matchSingle("slack_display_name", name);
    if (hit) break;
  }
  if (!hit && email) hit = await matchSingle("email", email);
  if (!hit) {
    for (const name of names) {
      hit = await matchSingle("name", name);
      if (hit) break;
    }
  }

  if (hit) {
    const { error } = await db.from("users").update({ slack_user_id: slackUserId }).eq("id", hit.id);
    if (error) console.warn("[slack/user-resolve] cache slack_user_id failed", { userId: hit.id, error });
    return hit;
  }

  console.error("[slack/user-resolve] no match", { slackUserId, displayName, realName, email });
  return null;
}
