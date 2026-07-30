import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { DemoDashboard } from "./_components/demo-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardDemoPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/dashboard");
  return <DemoDashboard />;
}
