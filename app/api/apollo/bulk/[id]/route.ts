import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ApolloBulkJob } from "@/lib/apollo/enrichment-types";

export const dynamic = "force-dynamic";

// GET /api/apollo/bulk/[id] -> { job } (polling de la découverte bulk).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await db
    .from("apollo_bulk_jobs")
    .select("id, status, companies, summary, error, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ job: data as Partial<ApolloBulkJob> });
}
