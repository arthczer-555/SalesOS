import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedCampaign, listSteps, normalizeCampaign } from "@/lib/prospecting/store/campaigns";

export const dynamic = "force-dynamic";

// POST : duplique une campagne (réglages + séquence, sans les prospects).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const steps = await listSteps(id);

  const { data, error } = await db
    .from("prospecting_campaigns")
    .insert({
      user_id: user.id,
      name: `${campaign.name} (copy)`.slice(0, 120),
      persona_id: campaign.persona_id,
      goal: campaign.goal,
      instructions: campaign.instructions,
      language: campaign.language,
      settings: campaign.settings,
    })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not duplicate" }, { status: 500 });

  if (steps.length) {
    const { error: stepsErr } = await db.from("prospecting_steps").insert(
      steps.map((s) => ({
        campaign_id: data.id,
        position: s.position,
        kind: s.kind,
        delay_days: s.delay_days,
        thread_mode: s.thread_mode,
        config: s.config,
      })),
    );
    if (stepsErr) return NextResponse.json({ error: stepsErr.message }, { status: 500 });
  }
  return NextResponse.json({ campaign: normalizeCampaign(data as Record<string, unknown>) });
}
