import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCampaignStats, getOwnedCampaign } from "@/lib/prospecting/store/campaigns";
import { localDay, localDayKey } from "@/lib/prospecting/schedule";
import type { CampaignReport, StepStatsRow } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET : rapport de campagne. Chaque bloc a sa propre erreur : un bloc en échec
// est signalé (errors[]) et rendu "Error" côté UI, jamais remplacé par des zéros.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const errors: string[] = [];
  const tz = campaign.settings.window.timezone;

  const [statsRes, stepsRes, repliesRes, sentRes] = await Promise.all([
    getCampaignStats([id]).then(
      (m) => m.get(id) ?? null,
      (e: unknown) => {
        errors.push(`stats: ${e instanceof Error ? e.message : "unavailable"}`);
        return null;
      },
    ),
    db.from("prospecting_step_stats").select("*").eq("campaign_id", id).order("position"),
    db.from("prospecting_replies").select("kind, category, received_at").eq("campaign_id", id).eq("user_id", user.id),
    db.from("prospecting_touches").select("sent_at").eq("campaign_id", id).eq("status", "sent").not("sent_at", "is", null),
  ]);
  if (stepsRes.error) errors.push(`steps: ${stepsRes.error.message}`);
  if (repliesRes.error) errors.push(`replies: ${repliesRes.error.message}`);
  if (sentRes.error) errors.push(`sends: ${sentRes.error.message}`);

  const replies = (repliesRes.data ?? []) as { kind: string; category: string | null; received_at: string }[];
  const breakdown = new Map<string, number>();
  for (const r of replies) {
    // Par type de message (aucune classification IA des réponses).
    const key = r.kind === "bounce" ? r.category ?? "bounce_hard" : r.kind;
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
  }

  // Série quotidienne (jour local du fuseau de la campagne), du 1er envoi à aujourd'hui (max 60 j).
  const daily = new Map<string, { sent: number; replies: number }>();
  const sentDates = ((sentRes.data ?? []) as { sent_at: string }[]).map((r) => new Date(r.sent_at));
  const first = sentDates.length ? new Date(Math.min(...sentDates.map((d) => d.getTime()))) : null;
  if (first) {
    const start = Math.max(first.getTime(), Date.now() - 59 * 86_400_000);
    for (let t = start; t <= Date.now() + 1; t += 86_400_000) daily.set(localDayKey(localDay(new Date(t), tz)), { sent: 0, replies: 0 });
    for (const d of sentDates) {
      const k = localDayKey(localDay(d, tz));
      const row = daily.get(k);
      if (row) row.sent++;
    }
    for (const r of replies) {
      if (r.kind !== "reply" && r.kind !== "colleague_reply") continue;
      const k = localDayKey(localDay(new Date(r.received_at), tz));
      const row = daily.get(k);
      if (row) row.replies++;
    }
  }

  const report: CampaignReport = {
    stats: statsRes,
    steps: (stepsRes.data ?? []) as StepStatsRow[],
    replyBreakdown: Array.from(breakdown.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    daily: Array.from(daily.entries()).map(([date, v]) => ({ date, ...v })),
    errors,
  };
  return NextResponse.json(report);
}
