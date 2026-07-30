// Dépôt d'une idée depuis la boîte à idées du dashboard. Ouvert à tous les
// utilisateurs connectés — la lecture, elle, est réservée aux admins
// (/admin/ideas).

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { IDEA_MAX_LENGTH } from "@/lib/ideas/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!content) return NextResponse.json({ error: "Idea is empty" }, { status: 400 });
  if (content.length > IDEA_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Idea is too long (${IDEA_MAX_LENGTH} characters max)` },
      { status: 400 },
    );
  }

  const { error } = await db.from("ideas").insert({ user_id: user.id, content });
  if (error) return NextResponse.json({ error: "Could not save your idea" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
