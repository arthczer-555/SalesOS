import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./db";
import { resolveAndStoreUserMappings } from "./onboarding/resolve-mappings";

export interface DbUser {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  created_at: string;
  mappings_resolved_at: string | null;
  // Lus par select("*") : présents sur la ligne, optionnels dans le type.
  slack_user_id?: string | null;
  hubspot_owner_id?: string | null;
}

export async function getAuthenticatedUser(): Promise<DbUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // Try to get existing user
  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("clerk_id", userId)
    .single();

  if (existing) {
    const u = existing as DbUser;
    // Filet de sécurité pour les sales créés avant l'onboarding auto : on résout
    // leurs mappings une seule fois (le timestamp est ensuite toujours posé).
    if (!u.mappings_resolved_at && u.email) {
      await resolveAndStoreUserMappings(u.id, u.email);
    }
    return u;
  }

  // First login — create row from Clerk data
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const name = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim();

  const { data: created } = await db
    .from("users")
    .upsert({
      clerk_id: userId,
      email,
      name: name || null,
      is_admin: false,
      // Instructions perso vides au départ : le bot guide est déjà en dur côté chat
      // (lib/guides/bot.ts). L'utilisateur n'ajoute que ses propres consignes par-dessus.
      user_prompt: null,
    })
    .select()
    .single();

  // Onboarding auto : résout et stocke Slack + HubSpot owner depuis l'email,
  // une seule fois, best-effort (ne bloque jamais le login).
  if (created && email) {
    await resolveAndStoreUserMappings((created as DbUser).id, email);
  }

  return (created as DbUser) ?? null;
}
