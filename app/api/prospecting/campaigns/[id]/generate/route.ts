import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { liveGenerateJob, parseGenerateParams, selectEnrollments } from "@/lib/prospecting/jobs/generate";
import { getOwnedCampaign } from "@/lib/prospecting/store/campaigns";
import { createJob, dispatchJob } from "@/lib/prospecting/store/jobs";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";

// Job de génération en cours sur la campagne (reprise de l'affichage au montage).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ running: await liveGenerateJob(id) });
}

// Lance l'écriture des séquences (job background). Un seul job de génération à
// la fois par campagne : si un job tourne déjà, on le renvoie tel quel.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "archived" || campaign.status === "completed") {
    return NextResponse.json({ error: "This campaign is closed." }, { status: 409 });
  }

  const running = await liveGenerateJob(id);
  if (running) return NextResponse.json({ job: running, alreadyRunning: true });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const p = parseGenerateParams({ ...body, campaignId: id });
  try {
    const selected = await selectEnrollments(id, p);
    if (!selected.length) {
      return NextResponse.json({ error: "No prospect needs messages for this selection." }, { status: 422 });
    }
    const job = await createJob({
      userId: user.id,
      kind: "generate",
      campaignId: id,
      params: { campaignId: id, enrollmentIds: p.enrollmentIds, scope: p.scope ?? (p.enrollmentIds?.length ? undefined : "missing"), force: p.force },
      total: selected.length,
      label: "Queued",
    });
    await dispatchJob(job, req.nextUrl.origin);
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: `Could not start generation: ${errMessage(e)}` }, { status: 500 });
  }
}
