import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { completeTask, TaskError, TASK_OUTCOMES } from "@/lib/prospecting/engine/tasks";
import { errMessage } from "@/lib/prospecting/store/util";
import type { TaskOutcome } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// POST { outcome?: "done" | "connected" | "no_answer" | "voicemail" | "replied" | "meeting_booked", note? }
// "replied" / "meeting_booked" arrêtent la séquence du prospect.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { outcome?: string; note?: string };
  if (body.outcome && !(TASK_OUTCOMES as string[]).includes(body.outcome)) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }
  try {
    const touch = await completeTask(user.id, id, { outcome: (body.outcome as TaskOutcome | undefined) ?? null, note: body.note ?? null });
    return NextResponse.json({ touch });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `Could not complete the task: ${errMessage(e)}` }, { status: 500 });
  }
}
