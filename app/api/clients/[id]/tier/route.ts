import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toClientTier } from "@/lib/clients/tier";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/tier
// Body: { tier: 1 | 2 | 3 | null }
//
// Tier du compte (importance fixée par l'équipe), modifiable par tout
// utilisateur connecté depuis la liste /clients ou le header de la fiche. On
// garde qui et quand. null retire le tier.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { tier?: unknown };
  const tier = body.tier == null ? null : toClientTier(body.tier);
  if (body.tier != null && tier === null) {
    return NextResponse.json({ error: "Invalid tier, expected 1, 2, 3 or null." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("clients")
    .update({
      tier,
      tier_set_by: tier ? user.email : null,
      tier_set_at: tier ? now : null,
      updated_at: now,
    })
    .eq("id", id)
    .select("id");

  if (error) {
    const missing = /tier/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "Database update pending (migration clients_tier.sql), the tier cannot be saved yet." : error.message },
      { status: 500 },
    );
  }
  if (!data?.length) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({ ok: true, tier });
}
