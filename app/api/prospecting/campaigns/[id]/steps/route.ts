import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { lintSequence } from "@/lib/prospecting/lint";
import { getOwnedCampaign, replaceSteps, stepRowToDraft, StepsSaveError } from "@/lib/prospecting/store/campaigns";

export const dynamic = "force-dynamic";

// PUT : remplace la séquence (ordre = positions). Les étapes existantes gardent
// leur id ; une modif de contenu rend obsolètes les messages non envoyés.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "archived") return NextResponse.json({ error: "This campaign is archived." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { steps?: unknown[] };
  if (!Array.isArray(body.steps)) return NextResponse.json({ error: "steps must be an array" }, { status: 400 });

  try {
    const { steps, outdated } = await replaceSteps(campaign, body.steps);
    const health = lintSequence(steps.map(stepRowToDraft), campaign.settings.window);
    return NextResponse.json({ steps, health, outdated });
  } catch (e) {
    if (e instanceof StepsSaveError) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the sequence" }, { status: 500 });
  }
}
