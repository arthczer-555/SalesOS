import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listTasks, TASK_BUCKETS } from "@/lib/prospecting/engine/tasks";
import { errMessage } from "@/lib/prospecting/store/util";
import type { TaskBucket, TaskKindFilter } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET /api/prospecting/tasks?bucket=overdue,today|upcoming|done&kind=linkedin|call|other&campaignId=
// Sans `bucket` : les quatre groupes. Les compteurs couvrent toujours tous les groupes.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const requested = (sp.get("bucket") ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter((b): b is TaskBucket => (TASK_BUCKETS as string[]).includes(b));
  const kindRaw = sp.get("kind");
  const kind: TaskKindFilter | null = kindRaw === "linkedin" || kindRaw === "call" || kindRaw === "other" ? kindRaw : null;
  const campaignId = sp.get("campaignId")?.trim() || null;

  try {
    const res = await listTasks(user.id, { buckets: requested.length ? requested : TASK_BUCKETS, kind, campaignId });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: `Could not load tasks: ${errMessage(e)}` }, { status: 500 });
  }
}
