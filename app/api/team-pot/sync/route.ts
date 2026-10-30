import { NextRequest, NextResponse } from "next/server";
import { authenticateCronOrUser } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { syncTeamPot } from "@/lib/team-pot/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Synchro du pot d'équipe (lib/team-pot/sync.ts). Appelée par le cron horaire
 * netlify/functions/team-pot-sync-scheduled.mts (Bearer CRON_SECRET) ou par un
 * admin ; body { weekly: true } force le récap du lundi, posté dans
 * #office-life sauf si TEAM_POT_SLACK_MODE=test.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateCronOrUser(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!auth.isCron) {
    const { data: userRow } = await db.from("users").select("is_admin").eq("id", auth.userId).single();
    if (!userRow?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { weekly?: unknown };
  const result = await syncTeamPot({ weekly: body.weekly === true });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
