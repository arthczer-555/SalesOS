import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { skipTask, TaskError } from "@/lib/prospecting/engine/tasks";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";

// POST { note? } : la tâche est sautée, la séquence continue.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { note?: string };
  try {
    const touch = await skipTask(user.id, id, body.note ?? null);
    return NextResponse.json({ touch });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `Could not skip the task: ${errMessage(e)}` }, { status: 500 });
  }
}
