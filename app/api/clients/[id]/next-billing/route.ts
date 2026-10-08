import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/next-billing
// Body: { date: "YYYY-MM-DD" | null }
//
// Date de prochaine facturation, saisie à la main par l'AM/CS (aucune source
// fiable : l'onglet "Factures" du sheet revenue ne contient que des factures
// émises). On garde qui et quand. null efface la date.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { date?: string | null };
  const date = body.date ? body.date.trim() : null;
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime()))) {
    return NextResponse.json({ error: "Invalid date, expected YYYY-MM-DD." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("clients")
    .update({
      next_billing_date: date,
      next_billing_set_by: date ? user.email : null,
      next_billing_set_at: date ? now : null,
      updated_at: now,
    })
    .eq("id", id)
    .select("id");

  if (error) {
    const missing = /next_billing/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "Database update pending (migration clients_next_billing.sql), the date cannot be saved yet." : error.message },
      { status: 500 },
    );
  }
  if (!data?.length) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({ ok: true, date });
}
