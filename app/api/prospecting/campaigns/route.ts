import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, normalizeStepDraft } from "@/lib/prospecting/settings";
import { cloneSteps, SYSTEM_TEMPLATES, templateForPersona } from "@/lib/prospecting/templates";
import { getCampaignStats, normalizeCampaign } from "@/lib/prospecting/store/campaigns";
import { loadPersonas } from "@/lib/prospecting/store/personas";
import type { CampaignListItem, StepDraft } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET : campagnes de l'utilisateur (hors archivées sauf ?archived=1) + stats.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const archived = req.nextUrl.searchParams.get("archived") === "1";
  let q = db.from("prospecting_campaigns").select("*").eq("user_id", user.id).eq("kind", "sequence").order("updated_at", { ascending: false });
  q = archived ? q.eq("status", "archived") : q.neq("status", "archived");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaigns = ((data ?? []) as Record<string, unknown>[]).map(normalizeCampaign);
  const ids = campaigns.map((c) => c.id);
  const [statsRes, stepsRes, personasRes] = await Promise.all([
    getCampaignStats(ids).then(
      (m) => ({ m, error: null as string | null }),
      (e: unknown) => ({ m: new Map(), error: e instanceof Error ? e.message : "Stats unavailable" }),
    ),
    ids.length ? db.from("prospecting_steps").select("campaign_id").in("campaign_id", ids) : Promise.resolve({ data: [] }),
    loadPersonas({ includeInactive: true }),
  ]);
  const stepCounts = new Map<string, number>();
  for (const r of ((stepsRes as { data: { campaign_id: string }[] | null }).data ?? [])) {
    stepCounts.set(r.campaign_id, (stepCounts.get(r.campaign_id) ?? 0) + 1);
  }
  const personaNames = new Map(personasRes.personas.map((p) => [p.id, p.name]));

  const items: CampaignListItem[] = campaigns.map((c) => ({
    ...c,
    stats: statsRes.m.get(c.id) ?? null,
    steps_count: stepCounts.get(c.id) ?? 0,
    persona_name: c.persona_id ? personaNames.get(c.persona_id) ?? null : null,
  }));
  return NextResponse.json({ campaigns: items, statsError: statsRes.error });
}

// POST : crée une campagne (draft) à partir d'un template, d'étapes fournies
// (proposition IA) ou vide.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    personaId?: string | null;
    templateKey?: string | null;
    steps?: unknown[];
    goal?: string;
    sourceListId?: string | null;
  };
  const name = (body.name ?? "").trim().slice(0, 120) || "Untitled campaign";
  const personaId = body.personaId?.trim() || null;

  let steps: StepDraft[] = [];
  if (Array.isArray(body.steps) && body.steps.length) {
    steps = body.steps.slice(0, 15).map((s, i) => normalizeStepDraft(s, i));
  } else if (body.templateKey) {
    const sys = SYSTEM_TEMPLATES.find((t) => t.key === body.templateKey);
    if (sys) steps = cloneSteps(sys.steps);
    else {
      const { data: tpl } = await db.from("prospecting_templates").select("steps").eq("id", body.templateKey).eq("user_id", user.id).maybeSingle();
      if (tpl && Array.isArray(tpl.steps)) steps = (tpl.steps as unknown[]).map((s, i) => normalizeStepDraft(s, i));
    }
  } else if (body.templateKey !== null) {
    const def = templateForPersona(personaId);
    if (def) steps = cloneSteps(def.steps);
  }

  const { data: campaign, error } = await db
    .from("prospecting_campaigns")
    .insert({
      user_id: user.id,
      name,
      persona_id: personaId,
      goal: (body.goal ?? "").slice(0, 2000),
      settings: DEFAULT_SETTINGS,
      source_list_id: body.sourceListId ?? null,
    })
    .select("*")
    .single();
  if (error || !campaign) return NextResponse.json({ error: error?.message ?? "Could not create the campaign" }, { status: 500 });

  if (steps.length) {
    const rows = steps.map((s, i) => ({
      campaign_id: campaign.id,
      position: i + 1,
      kind: s.kind,
      delay_days: i === 0 ? 0 : s.delayDays,
      thread_mode: s.threadMode,
      config: s.config,
    }));
    const { error: stepsErr } = await db.from("prospecting_steps").insert(rows);
    if (stepsErr) return NextResponse.json({ error: stepsErr.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: normalizeCampaign(campaign as Record<string, unknown>) });
}
