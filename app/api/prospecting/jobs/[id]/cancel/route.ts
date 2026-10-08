import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getJob } from "@/lib/prospecting/store/jobs";

export const dynamic = "force-dynamic";

// POST : annule un job en cours. Le runner vérifie l'annulation entre deux
// éléments ; les prospects encore en file repassent dans leur état précédent.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await getJob(id);
  if (!job || job.user_id !== user.id) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "queued" && job.status !== "running") return NextResponse.json({ job });

  const now = new Date().toISOString();
  const { data } = await db
    .from("prospecting_jobs")
    .update({ status: "canceled", finished_at: now, updated_at: now })
    .eq("id", id)
    .select("*")
    .single();
  if (job.kind === "generate" && job.campaign_id) {
    // Prospects restés en file : "outdated" s'ils avaient déjà des messages, sinon "none".
    const { data: queued } = await db
      .from("prospecting_enrollments")
      .select("id")
      .eq("campaign_id", job.campaign_id)
      .eq("content_status", "queued");
    const ids = ((queued ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length) {
      const { data: withTouches } = await db.from("prospecting_touches").select("enrollment_id").in("enrollment_id", ids);
      const has = new Set(((withTouches ?? []) as { enrollment_id: string }[]).map((t) => t.enrollment_id));
      const outdated = ids.filter((x) => has.has(x));
      const none = ids.filter((x) => !has.has(x));
      if (outdated.length) await db.from("prospecting_enrollments").update({ content_status: "outdated", updated_at: now }).in("id", outdated);
      if (none.length) await db.from("prospecting_enrollments").update({ content_status: "none", updated_at: now }).in("id", none);
    }
  }
  return NextResponse.json({ job: data });
}
