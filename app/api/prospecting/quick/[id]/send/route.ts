import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { QuickError, sendQuickTouch } from "@/lib/prospecting/store/quick";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { enrollmentId } : envoie l'email d'un prospect du lot maintenant, depuis
// la boîte d'envoi (mêmes garde-fous que les séquences : suppression, dédup,
// mode d'envoi, anti double-envoi). 422 + touch si l'envoi n'a pas eu lieu.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { enrollmentId?: string };
  if (!body.enrollmentId) return NextResponse.json({ error: "enrollmentId is required" }, { status: 400 });
  try {
    const res = await sendQuickTouch(user.id, id, body.enrollmentId);
    if (res.status === "sent") return NextResponse.json({ touch: res.touch });
    return NextResponse.json({ error: res.error, touch: res.touch }, { status: 422 });
  } catch (e) {
    if (e instanceof QuickError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
