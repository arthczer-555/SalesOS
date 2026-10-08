import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedCampaign, normalizeCampaign } from "@/lib/prospecting/store/campaigns";
import { logEvent } from "@/lib/prospecting/store/events";

export const dynamic = "force-dynamic";

// POST : met la campagne en pause. Le cron ne traite que les campagnes actives,
// les prospects gardent leur position et reprennent au resume.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "active") return NextResponse.json({ error: "Only a running campaign can be paused." }, { status: 409 });

  const { data, error } = await db
    .from("prospecting_campaigns")
    .update({ status: "paused", pause_reason: "manual", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent({ type: "paused", userId: user.id, campaignId: id, data: { scope: "campaign" } });
  return NextResponse.json({ campaign: normalizeCampaign(data as Record<string, unknown>) });
}
