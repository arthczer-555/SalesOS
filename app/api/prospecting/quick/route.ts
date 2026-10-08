import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { ANGLE_KEYS } from "@/lib/prospecting/settings";
import { createQuickSession, listQuickSessions, QuickError } from "@/lib/prospecting/store/quick";
import { errMessage } from "@/lib/prospecting/store/util";
import type { AngleKey, LeadInput } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET : derniers lots Quick email (stats : envoyés, réponses).
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ sessions: await listQuickSessions(user.id) });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

// POST { leads, instructions?, angle? } : crée un lot et renvoie ses prospects
// (les prospects bloqués, ex. déjà en séquence, sont écartés et listés).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { leads?: LeadInput[]; instructions?: string; angle?: string };
  const leads = Array.isArray(body.leads) ? body.leads.filter((l) => l && typeof l === "object") : [];
  const angle = typeof body.angle === "string" && ANGLE_KEYS.includes(body.angle as AngleKey) ? (body.angle as AngleKey) : null;
  try {
    const res = await createQuickSession(user.id, leads, { instructions: typeof body.instructions === "string" ? body.instructions : "", angle });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof QuickError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
