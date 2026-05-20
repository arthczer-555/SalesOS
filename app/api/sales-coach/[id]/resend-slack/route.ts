import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendSalesCoachSlack } from "@/lib/sales-coach/slack";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, status")
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.status !== "done") {
    return NextResponse.json({ error: `Cannot send — status is ${row.status}` }, { status: 400 });
  }

  const result = await sendSalesCoachSlack(db, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true });
}
