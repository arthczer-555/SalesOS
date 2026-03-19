import type { DbUser } from "./auth";

export function isAdmin(user: DbUser): boolean {
  return user.is_admin || user.email === "arthur@coachello.io";
}
