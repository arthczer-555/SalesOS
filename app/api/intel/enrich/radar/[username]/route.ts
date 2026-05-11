import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { username } = await ctx.params;

  // Mark inactive in our DB. Le retrait côté Netrows se fait via le dashboard
  // Netrows (pas d'endpoint DELETE Radar dans la doc actuelle).
  const { error } = await db
    .from("linkedin_monitored_profiles")
    .update({ radar_active: false })
    .eq("username", username);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, note: "Profil retiré du monitoring local. Pour libérer le slot Netrows, utilise le dashboard Netrows." });
}
