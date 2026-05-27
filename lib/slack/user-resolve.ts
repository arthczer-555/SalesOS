import { db } from "@/lib/db";
import { getUserInfo } from "./api";

/**
 * Résout un Slack user_id vers un DbUser SalesOS via l'email (récupéré côté
 * Slack via users.info).
 *
 * Utilisé par le handler /api/slack/events pour :
 *  - savoir qui pose la question (et donc imputer les crédits Claude au
 *    bon user via logUsage)
 *  - charger la clé Claude chiffrée du user (table user_keys)
 *  - charger son user_prompt + son owner_id HubSpot
 *
 * Retourne null si l'email Slack ne matche aucun user SalesOS, auquel cas
 * le caller doit poliment refuser de répondre.
 */
export async function resolveSlackUser(slackUserId: string): Promise<{
  id: string;
  email: string;
  name: string | null;
} | null> {
  try {
    const info = await getUserInfo(slackUserId);
    const email = info.profile?.email?.toLowerCase();
    if (!email) return null;

    const { data: user } = await db
      .from("users")
      .select("id, email, name")
      .ilike("email", email)
      .single();

    if (!user) return null;
    return user as { id: string; email: string; name: string | null };
  } catch (e) {
    console.warn("[slack/user-resolve] failed:", e);
    return null;
  }
}
