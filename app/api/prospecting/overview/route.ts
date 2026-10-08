import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HUMAN_KINDS } from "@/lib/prospecting/replies/shared";
import { getMailboxHealth } from "@/lib/prospecting/store/mailbox";

export const dynamic = "force-dynamic";

// GET ?repliesSince=ISO : compteurs des onglets (tâches dues, réponses humaines
// reçues depuis la dernière visite de Replies, 7 jours par défaut, campagnes
// actives) + santé de la boîte d'envoi. Un compteur en échec vaut null (l'UI
// affiche une erreur, jamais un 0 trompeur).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date().toISOString();
  const sinceParam = req.nextUrl.searchParams.get("repliesSince");
  const sinceDate = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : null;
  const since = (sinceDate ?? new Date(Date.now() - 7 * 86_400_000)).toISOString();

  const [tasks, inbox, active, health] = await Promise.all([
    db
      .from("prospecting_touches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "due")
      .neq("kind", "email")
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    // Réponses humaines (même définition que le filtre "Replies", lib/prospecting/replies/shared.ts).
    db
      .from("prospecting_replies")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gt("received_at", since)
      .in("kind", HUMAN_KINDS),
    db.from("prospecting_campaigns").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "sequence").eq("status", "active"),
    getMailboxHealth(user.id).catch(() => null),
  ]);

  return NextResponse.json({
    tasksDue: tasks.error ? null : tasks.count ?? 0,
    repliesNew: inbox.error ? null : inbox.count ?? 0,
    campaignsActive: active.error ? null : active.count ?? 0,
    health,
  });
}
