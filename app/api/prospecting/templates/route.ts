import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeStepDraft } from "@/lib/prospecting/settings";
import { SYSTEM_TEMPLATES } from "@/lib/prospecting/templates";
import type { SequenceTemplate } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET : templates système + templates sauvegardés de l'utilisateur.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db.from("prospecting_templates").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  const mine: SequenceTemplate[] = ((data ?? []) as { id: string; name: string; description: string; persona_id: string | null; steps: unknown[] }[]).map((t) => ({
    key: t.id,
    name: t.name,
    description: t.description,
    personaId: t.persona_id,
    system: false,
    steps: (Array.isArray(t.steps) ? t.steps : []).map((s, i) => normalizeStepDraft(s, i)),
  }));
  return NextResponse.json({ templates: [...SYSTEM_TEMPLATES, ...mine], error: error?.message ?? null });
}

// POST : sauvegarde une séquence comme template réutilisable.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string; personaId?: string | null; steps?: unknown[] };
  const name = (body.name ?? "").trim().slice(0, 100);
  if (!name) return NextResponse.json({ error: "Give the template a name." }, { status: 400 });
  const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 15).map((s, i) => {
    const d = normalizeStepDraft(s, i);
    return { kind: d.kind, delayDays: d.delayDays, threadMode: d.threadMode, config: d.config };
  });
  if (steps.length === 0) return NextResponse.json({ error: "The sequence is empty." }, { status: 400 });
  const { data, error } = await db
    .from("prospecting_templates")
    .insert({ user_id: user.id, name, description: (body.description ?? "").slice(0, 500), persona_id: body.personaId || null, steps })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
