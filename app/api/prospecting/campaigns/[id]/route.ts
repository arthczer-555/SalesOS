import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lintSequence } from "@/lib/prospecting/lint";
import { normalizeSettings } from "@/lib/prospecting/settings";
import { getCampaignStats, getOwnedCampaign, listSteps, normalizeCampaign, stepRowToDraft } from "@/lib/prospecting/store/campaigns";
import { getPersona } from "@/lib/prospecting/store/personas";
import type { CampaignLanguage, CampaignSettings } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const [steps, statsMap, persona] = await Promise.all([
    listSteps(id),
    getCampaignStats([id]).catch(() => null),
    getPersona(campaign.persona_id),
  ]);
  const health = lintSequence(steps.map(stepRowToDraft), campaign.settings.window);
  return NextResponse.json({
    campaign,
    steps,
    stats: statsMap?.get(id) ?? null,
    statsError: statsMap ? null : "Stats unavailable",
    persona,
    health,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    goal?: string;
    instructions?: string;
    language?: CampaignLanguage;
    personaId?: string | null;
    settings?: Partial<CampaignSettings>;
  };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120) || campaign.name;
  if (typeof body.goal === "string") patch.goal = body.goal.slice(0, 2000);
  if (typeof body.instructions === "string") patch.instructions = body.instructions.slice(0, 4000);
  if (body.language === "auto" || body.language === "en" || body.language === "fr") patch.language = body.language;
  if (body.personaId !== undefined) patch.persona_id = body.personaId || null;
  if (body.settings && typeof body.settings === "object") {
    patch.settings = normalizeSettings({
      ...campaign.settings,
      ...body.settings,
      window: { ...campaign.settings.window, ...(body.settings.window ?? {}) },
    });
  }

  const { data, error } = await db.from("prospecting_campaigns").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: normalizeCampaign(data as Record<string, unknown>) });
}

// DELETE : archive (stoppe les séquences en cours). ?hard=1 supprime un draft
// qui n'a jamais rien envoyé.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const now = new Date().toISOString();

  if (req.nextUrl.searchParams.get("hard") === "1") {
    const { count } = await db
      .from("prospecting_touches")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .in("status", ["sent", "done", "sending"]);
    if ((count ?? 0) > 0) return NextResponse.json({ error: "This campaign already sent messages: archive it instead." }, { status: 409 });
    const { error } = await db.from("prospecting_campaigns").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: true });
  }

  await db
    .from("prospecting_enrollments")
    .update({ status: "stopped", stop_reason: "campaign_archived", next_run_at: null, updated_at: now })
    .eq("campaign_id", id)
    .in("status", ["pending", "active", "paused"]);
  await db
    .from("prospecting_touches")
    .update({ status: "canceled", updated_at: now })
    .eq("campaign_id", id)
    .in("status", ["draft", "approved", "due"]);
  const { error } = await db.from("prospecting_campaigns").update({ status: "archived", updated_at: now }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, archived: true });
}
