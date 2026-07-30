// « Voir comme » : un admin consulte le dashboard réel d'un collègue.
//
// Lecture seule et réservée aux admins. Renvoie toujours la liste des
// utilisateurs consultables, plus le dashboard de celui demandé — la page a
// besoin des deux au premier rendu.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { buildMeDashboard, listDashboardUsers, type DashboardUser } from "@/lib/dashboard/me";
import type { MeDashboardResponse } from "@/lib/ae-activity/types";

export const dynamic = "force-dynamic";

export type AdminUserDashboardResponse = {
  users: DashboardUser[];
  selectedUserId: string | null;
  dashboard: MeDashboardResponse | null;
};

export async function GET(req: NextRequest) {
  const me = await getAuthenticatedUser();
  if (!me || !isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await listDashboardUsers();
  const requested = req.nextUrl.searchParams.get("userId");
  // Par défaut, le premier utilisateur qui a réellement des données : ouvrir
  // sur un dashboard vide n'apprendrait rien.
  const fallback = users.find((u) => u.hasSnapshot) ?? users[0] ?? null;
  const selected = (requested && users.find((u) => u.id === requested)) || fallback;

  const payload: AdminUserDashboardResponse = {
    users,
    selectedUserId: selected?.id ?? null,
    dashboard: selected ? await buildMeDashboard(selected.id) : null,
  };
  return NextResponse.json(payload);
}
