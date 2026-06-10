import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ApolloEnrichJob } from "@/lib/apollo/enrichment-types";

export const dynamic = "force-dynamic";

// GET /api/apollo/enrich/[id] -> { job } (polling du statut + progression).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await db
    .from("apollo_enrichment_jobs")
    .select("id, status, people, summary, error, credits_used, hubspot_company_name, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ job: data as Partial<ApolloEnrichJob> });
}
