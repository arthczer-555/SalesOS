import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { regenerateTouch, RegenerateError } from "@/lib/prospecting/ai/write-step";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Régénère une seule étape d'un prospect, avec une consigne optionnelle.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { instruction?: unknown };
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, 1000) : null;

  const { data: owned } = await db.from("prospecting_touches").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  try {
    const touch = await regenerateTouch(id, instruction);
    return NextResponse.json({ touch });
  } catch (e) {
    const status = e instanceof RegenerateError ? e.status : 502;
    return NextResponse.json({ error: errMessage(e) }, { status });
  }
}
