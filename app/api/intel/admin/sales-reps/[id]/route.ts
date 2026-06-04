import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SELECT = "id, name, email, hubspot_owner_id, in_roster";

// PATCH /api/intel/admin/sales-reps/[id]
// Met à jour un rep du roster. Si le nom change, cascade sur scope_companies.owner
// (sinon la liste prio du rep se viderait). Collision de nom (case-insensitive) → 409.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string | null;
    hubspot_owner_id?: string | null;
    in_roster?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const { data: current, error: curErr } = await db
    .from("sales_reps")
    .select("id, name")
    .eq("id", id)
    .single();
  if (curErr || !current) return NextResponse.json({ error: "Sales introuvable" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.email !== undefined) patch.email = body.email?.trim() || null;
  if (body.hubspot_owner_id !== undefined) patch.hubspot_owner_id = body.hubspot_owner_id?.trim() || null;
  if (body.in_roster !== undefined) patch.in_roster = body.in_roster;

  const oldName = (current.name ?? "").trim();
  const newName = body.name?.trim();
  const renaming = !!newName && newName.toLowerCase() !== oldName.toLowerCase();

  if (renaming) {
    // Collision : un autre rep porte déjà ce nom (case-insensitive).
    const { data: clash } = await db
      .from("sales_reps")
      .select("id")
      .ilike("name", newName!)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (clash) return NextResponse.json({ error: "Un sales porte déjà ce nom" }, { status: 409 });
    patch.name = newName;
  } else if (newName) {
    // Même nom à la casse près : on garde la nouvelle casse sans cascade.
    patch.name = newName;
  }

  const { data, error } = await db.from("sales_reps").update(patch).eq("id", id).select(SELECT).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Un sales porte déjà ce nom" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Cascade : réaffecte les companies de l'ancien owner vers le nouveau nom.
  if (renaming && oldName) {
    await db.from("scope_companies").update({ owner: newName }).ilike("owner", oldName);
  }

  return NextResponse.json({ rep: data });
}

// DELETE /api/intel/admin/sales-reps/[id]
// Retire le rep du roster (in_roster=false) sans toucher aux companies : leurs
// owners restent et apparaissent dans "Hors roster".
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const { error } = await db
    .from("sales_reps")
    .update({ in_roster: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
