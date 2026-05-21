import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface UpdateNotesResponse {
  ok: boolean;
  notes: string | null;
  error?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ok: false, notes: null, error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  let body: { notes?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, notes: null, error: "Body JSON invalide" }, { status: 400 });
  }

  const notes = typeof body.notes === "string" ? body.notes : null;

  const { data, error } = await db
    .from("scope_companies")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("notes")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, notes: null, error: error?.message ?? "Compte introuvable" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, notes: data.notes });
}
