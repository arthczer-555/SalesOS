import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Insights } from "@/lib/clients/types";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/insights
// Body: { actionId: string, done: boolean }
//
// "Done" / "Undo" sur une Next action. L'action faite reste stockée (done_at,
// done_by) : elle disparaît de Key insights et le prochain refresh la passe au
// modèle comme "already done" pour ne pas la reproposer.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { actionId?: unknown; done?: unknown };
  const actionId = typeof body.actionId === "string" ? body.actionId : "";
  if (!actionId || typeof body.done !== "boolean") {
    return NextResponse.json({ error: "actionId and done are required" }, { status: 400 });
  }

  const { data: row, error } = await db.from("clients").select("insights").eq("id", id).single();
  if (error || !row) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const insights = row.insights as Insights | null;
  const actions = insights?.actions ?? [];
  if (!actions.some((a) => a.id === actionId)) return NextResponse.json({ error: "Action not found" }, { status: 404 });

  const now = new Date().toISOString();
  const next: Insights = {
    ...(insights as Insights),
    actions: actions.map((a) =>
      a.id === actionId ? { ...a, done_at: body.done ? now : null, done_by: body.done ? user.email : null } : a,
    ),
  };

  const { error: updErr } = await db.from("clients").update({ insights: next, updated_at: now }).eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, insights: next });
}
