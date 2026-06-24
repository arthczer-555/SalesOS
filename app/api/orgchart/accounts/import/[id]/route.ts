import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/orgchart/accounts/import/[id] -> { job } (polling import / reorganize).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await db
    .from("orgchart_import_jobs")
    .select("id, source, status, account_id, result, progress, error, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id) // ne pas exposer les jobs d'un autre utilisateur (PII Apollo). S2
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job: data });
}
