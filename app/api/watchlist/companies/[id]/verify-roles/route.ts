import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyContactRoles, type VerifyRolesResult } from "@/lib/watchlist/verify-contact-roles";

export const dynamic = "force-dynamic";
// Le match Apollo se fait contact par contact : on laisse de la marge.
export const maxDuration = 60;

export type VerifyRolesResponse = VerifyRolesResult;

// POST /api/watchlist/companies/[id]/verify-roles
// Vérifie via Apollo les postes (et entreprises) des contacts HubSpot de la
// company. N'écrit RIEN sur HubSpot : renvoie des propositions à confirmer.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const { data: company } = await db
    .from("scope_companies")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  try {
    const result = await verifyContactRoles(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verification failed" },
      { status: 500 },
    );
  }
}
