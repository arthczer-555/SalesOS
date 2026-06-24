import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runReorganize } from "@/lib/orgchart/run-reorganize";
import { triggerBackgroundJob } from "@/lib/orgchart/dispatch-job";

export const dynamic = "force-dynamic";

const BG_FN = "orgchart-reorganize-background";

// POST /api/orgchart/accounts/[id]/reorganize — relance la classification Claude
// sur les personnes existantes (entité/niveau/manager) en background.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const { data: job, error } = await db
    .from("orgchart_import_jobs")
    .insert({ user_id: user.id, source: "reorganize", account_id: id, status: "running", params: {} })
    .select("id")
    .single();
  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  await triggerBackgroundJob({
    jobId: job.id,
    fnName: BG_FN,
    table: "orgchart_import_jobs",
    origin: req.nextUrl.origin,
    run: () => runReorganize({ jobId: job.id }),
  });
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
