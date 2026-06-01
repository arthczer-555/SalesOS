import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./db";
import { DEFAULT_BOT_GUIDE } from "./guides/bot";
import { resolveAndStoreUserMappings } from "./onboarding/resolve-mappings";

export interface DbUser {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  created_at: string;
  mappings_resolved_at: string | null;
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
      user_prompt: DEFAULT_BOT_GUIDE,
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
