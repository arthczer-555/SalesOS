import { db } from "./db";

// Les jobs cron n'ont pas de user authentifié. Par défaut leurs appels Claude
// étaient loggués avec user_id = null et regroupés sous "Système (cron /
// non-attribué)" dans l'admin. On préfère les imputer à un user réel pour que
// la facture soit attribuée à un compte plutôt qu'au système.
//
// Résolution (premier non-vide gagne) :
//   1. CRON_USER_ID    — l'id Clerk exact du user à qui imputer
//   2. CRON_USER_EMAIL — résolu vers son id via la table users
//   3. null            — fallback historique ("Système")
//
// Mis en cache pour la durée du process (1 lookup par run de cron max).
let cached: string | null | undefined;

export async function resolveCronUserId(): Promise<string | null> {
  if (cached !== undefined) return cached;

  const explicitId = process.env.CRON_USER_ID?.trim();
  if (explicitId) {
    cached = explicitId;
    return cached;
  }

  const email = process.env.CRON_USER_EMAIL?.trim();
  if (email) {
    const { data, error } = await db
      .from("users")
      .select("id")
      .eq("email", email)
      .single<{ id: string }>();
    if (error) {
      console.warn(`[cron-user] CRON_USER_EMAIL="${email}" introuvable: ${error.message}`);
    }
    cached = data?.id ?? null;
    return cached;
  }

  cached = null;
  return cached;
}
