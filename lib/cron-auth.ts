import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export type CronOrUser =
  | { isCron: true; userId: null }
  | { isCron: false; userId: string };

/**
 * Allow either a Clerk user (UI trigger) or a `Bearer CRON_SECRET` (Netlify
 * scheduled function). Returns `null` if neither is valid → caller should
 * respond 401.
 *
 * Routes using this MUST be whitelisted in `middleware.ts` since Clerk's
 * middleware otherwise blocks the request before we can check Bearer.
 */
export async function authenticateCronOrUser(req: NextRequest): Promise<CronOrUser | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { isCron: true, userId: null };
  }

  const user = await getAuthenticatedUser();
  if (user) return { isCron: false, userId: user.id };

  return null;
}
