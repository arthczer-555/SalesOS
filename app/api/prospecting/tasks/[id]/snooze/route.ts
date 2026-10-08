import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { snoozeTask, TaskError } from "@/lib/prospecting/engine/tasks";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";

// POST { until: ISO date } : la tâche réapparaît à cette date.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { until?: string };
  if (!body.until) return NextResponse.json({ error: "Missing snooze date" }, { status: 400 });
  try {
    const touch = await snoozeTask(user.id, id, body.until);
    return NextResponse.json({ touch });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `Could not snooze the task: ${errMessage(e)}` }, { status: 500 });
  }
}
