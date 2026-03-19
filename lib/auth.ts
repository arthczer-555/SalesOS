import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./db";

export interface DbUser {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  created_at: string;
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

  if (existing) return existing as DbUser;

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
      is_admin: email === "arthur@coachello.io",
    })
    .select()
    .single();

  return (created as DbUser) ?? null;
}
