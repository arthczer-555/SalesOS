import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeCreateSalesRep } from "@/lib/scope-companies";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("scope_companies")
    .select("id, name, owner, notes, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message, companies: [] }, { status: 500 });
  return NextResponse.json({ companies: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    owner?: string | null;
    notes?: string | null;
  } | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name requis" }, { status: 400 });
  }

  const payload = {
    name: body.name.trim(),
    owner: body.owner?.trim() || null,
    notes: body.notes?.trim() || null,
  };

  const { data, error } = await db
    .from("scope_companies")
    .insert(payload)
    .select("id, name, owner, notes, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Entreprise déjà présente" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await maybeCreateSalesRep(payload.owner);
  return NextResponse.json({ company: data });
}
