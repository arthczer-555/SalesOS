import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeCreateSalesRep } from "@/lib/scope-companies";

export const dynamic = "force-dynamic";

// POST /api/intel/admin/scope-companies/assign
// Attribue en lot des companies à un sales (owner). owner=null => "Non attribué".
// Utilisé par le drag & drop du board et le menu "Assigner à…".
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { ids?: unknown; owner?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids requis" }, { status: 400 });

  const ownerRaw = typeof body?.owner === "string" ? body.owner.trim() : "";
  const owner = ownerRaw || null;

  const { error } = await db
    .from("scope_companies")
    .update({ owner, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (owner) await maybeCreateSalesRep(owner);

  return NextResponse.json({ ok: true, updated: ids.length, owner });
}
