import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { QuickError, writeQuickTouch } from "@/lib/prospecting/store/quick";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { enrollmentId, instructions? } : écrit (ou réécrit) l'email d'un prospect du lot.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { enrollmentId?: string; instructions?: string };
  if (!body.enrollmentId) return NextResponse.json({ error: "enrollmentId is required" }, { status: 400 });
  try {
    const touch = await writeQuickTouch(user.id, id, body.enrollmentId, typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "");
    return NextResponse.json({ touch });
  } catch (e) {
    if (e instanceof QuickError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
