import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await db
    .from("netrows_search_jobs")
    .select("id, user_id, status, combos_total, combos_done, profiles, total, capped, combo_logs, error_message, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (data.user_id && data.user_id !== user.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    combosTotal: data.combos_total,
    combosDone: data.combos_done,
    profiles: data.profiles ?? [],
    total: data.total ?? 0,
    capped: data.capped ?? null,
    comboLogs: data.combo_logs ?? [],
    error: data.error_message ?? null,
  });
}
