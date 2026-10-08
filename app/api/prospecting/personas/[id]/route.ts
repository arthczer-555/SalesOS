import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { normalizePersona } from "@/lib/prospecting/personas";
import { savePersona } from "@/lib/prospecting/store/personas";
import type { Persona } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// PUT : crée ou met à jour un persona (cibles partagées par toute l'équipe).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9_-]{2,40}$/.test(id)) return NextResponse.json({ error: "Invalid persona id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { persona?: Persona };
  if (!body.persona) return NextResponse.json({ error: "persona is required" }, { status: 400 });
  const persona = normalizePersona({ ...(body.persona as unknown as Record<string, unknown>), id });
  if (!persona.name.trim()) return NextResponse.json({ error: "Give the persona a name." }, { status: 400 });
  try {
    return NextResponse.json({ persona: await savePersona(persona, user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
