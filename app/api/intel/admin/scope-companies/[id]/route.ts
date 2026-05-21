import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeCreateSalesRep } from "@/lib/scope-companies";

export const dynamic = "force-dynamic";

const COLS =
  "id, name, owner, sector, current_coaching_platform, notes, created_at, updated_at";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    owner?: string | null;
    sector?: string | null;
    current_coaching_platform?: string | null;
    notes?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Body invalide" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: "name vide" }, { status: 400 });
    patch.name = trimmed;
  }
  if (body.owner !== undefined) patch.owner = body.owner?.toString().trim() || null;
  if (body.sector !== undefined) patch.sector = body.sector?.toString().trim() || null;
  if (body.current_coaching_platform !== undefined)
    patch.current_coaching_platform = body.current_coaching_platform?.toString().trim() || null;
  if (body.notes !== undefined) patch.notes = body.notes?.toString().trim() || null;

  const { data, error } = await db
    .from("scope_companies")
    .update(patch)
    .eq("id", id)
    .select(COLS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Entreprise déjà présente" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (typeof patch.owner === "string") await maybeCreateSalesRep(patch.owner as string);
  return NextResponse.json({ company: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const { error } = await db.from("scope_companies").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
