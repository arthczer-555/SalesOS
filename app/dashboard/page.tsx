import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { MyDashboard } from "./_components/my-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in");

  // Aucune garde de rôle : la page s'affiche pour tous et explique elle-même ce
  // qui manque (hors roster, pas d'owner HubSpot, snapshot pas encore calculé).
  const firstName = (user.name ?? user.email).split(" ")[0];
  return <MyDashboard firstName={firstName} isAdmin={isAdmin(user)} />;
}
