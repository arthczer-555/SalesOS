import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
  const prefs = data?.content ? (JSON.parse(data.content) as Record<string, string>) : {};
  return NextResponse.json(prefs);
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prefs = await req.json() as Record<string, string>;

  await db.from("guide_defaults").upsert({ key: "model_preferences", content: JSON.stringify(prefs) }, { onConflict: "key" });

  return NextResponse.json({ ok: true });
}
