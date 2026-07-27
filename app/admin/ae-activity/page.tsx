import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { AeAdminTabs } from "./_components/tabs";

export const dynamic = "force-dynamic";

// Page admin de pilotage sales, réservée aux admins (users.is_admin). Deux
// onglets :
//  - "AE Activity" : activité commerciale par AE, depuis le cache Supabase
//    (ae_activity_snapshots) via /api/admin/ae-activity.
//  - "Deal Review" (?tab=deals) : revue de pipeline deal par deal, live
//    HubSpot via /api/admin/deal-review.
export default async function AeActivityPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");
  return <AeAdminTabs />;
}
