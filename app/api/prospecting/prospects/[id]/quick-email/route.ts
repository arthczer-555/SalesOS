import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeQuickEmail } from "@/lib/prospecting/ai/quick-email";
import { ANGLE_KEYS } from "@/lib/prospecting/settings";
import { getContact } from "@/lib/prospecting/store/contacts";
import { errMessage } from "@/lib/prospecting/store/util";
import type { AngleKey } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Email ponctuel hors séquence pour un prospect (brouillon, l'envoi passe par
// /api/gmail/send côté UI).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { instructions?: unknown; angle?: unknown };

  const contact = await getContact(id);
  if (!contact) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  // Registre d'équipe : accès si le user a créé le prospect ou l'a dans une de ses campagnes.
  if (contact.created_by !== user.id) {
    const { count } = await db
      .from("prospecting_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .eq("user_id", user.id);
    if (!count) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }
  const angle = typeof body.angle === "string" && ANGLE_KEYS.includes(body.angle as AngleKey) ? (body.angle as AngleKey) : null;
  try {
    const draft = await writeQuickEmail({
      contact,
      userId: user.id,
      instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "",
      angle,
    });
    return NextResponse.json(draft);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
