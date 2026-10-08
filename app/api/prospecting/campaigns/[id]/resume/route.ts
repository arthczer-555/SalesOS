import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { nextWindowOpen } from "@/lib/prospecting/schedule";
import { activateEnrollments } from "@/lib/prospecting/store/activation";
import { getOwnedCampaign, normalizeCampaign } from "@/lib/prospecting/store/campaigns";
import { logEvent } from "@/lib/prospecting/store/events";

export const dynamic = "force-dynamic";

// POST : reprend une campagne en pause. Les échéances passées pendant la pause
// sont repoussées à la prochaine ouverture de fenêtre (pas de rafale au resume).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "paused") return NextResponse.json({ error: "Only a paused campaign can be resumed." }, { status: 409 });

  const now = new Date();
  const { data, error } = await db
    .from("prospecting_campaigns")
    .update({ status: "active", pause_reason: null, updated_at: now.toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const active = normalizeCampaign(data as Record<string, unknown>);

  await db
    .from("prospecting_enrollments")
    .update({ next_run_at: nextWindowOpen(now, active.settings.window).toISOString(), updated_at: now.toISOString() })
    .eq("campaign_id", id)
    .eq("status", "active")
    .lt("next_run_at", now.toISOString());

  const { activated } = await activateEnrollments(active);
  await logEvent({ type: "resumed", userId: user.id, campaignId: id, data: { scope: "campaign", activated } });
  return NextResponse.json({ campaign: active, activated });
}
