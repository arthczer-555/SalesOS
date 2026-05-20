import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LEAD_SOURCE_CATEGORIES } from "@/lib/marketing-types";

export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>(LEAD_SOURCE_CATEGORIES);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { source?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.source;
  let source: string | null;
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    source = null;
  } else if (typeof raw === "string" && ALLOWED.has(raw)) {
    source = raw;
  } else {
    return NextResponse.json(
      { error: `source must be null or one of: ${LEAD_SOURCE_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }

  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, last_analysis_id")
    .eq("id", id)
    .single();
  if (leadErr || !lead) {
    return NextResponse.json({ error: leadErr?.message ?? "Lead not found" }, { status: 404 });
  }
  if (!lead.last_analysis_id) {
    return NextResponse.json(
      { error: "Lead has no analysis row yet. Analyse it first." },
      { status: 409 },
    );
  }

  const { error: updErr } = await db
    .from("lead_analyses")
    .update({ extracted_source: source, updated_at: new Date().toISOString() })
    .eq("id", lead.last_analysis_id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, source });
}
