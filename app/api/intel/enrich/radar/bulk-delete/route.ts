import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { usernames?: unknown } | null;
  const usernames = Array.isArray(body?.usernames)
    ? (body!.usernames as unknown[]).filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];

  if (usernames.length === 0) {
    return NextResponse.json({ error: "usernames (string[]) requis" }, { status: 400 });
  }

  const { error, count } = await db
    .from("linkedin_monitored_profiles")
    .update({ radar_active: false }, { count: "exact" })
    .in("username", usernames);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    removed: count ?? usernames.length,
    note: "Profils retirés du monitoring local. Pour libérer les slots Netrows, utilise le dashboard Netrows.",
  });
}
