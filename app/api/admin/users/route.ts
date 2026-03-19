import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: users } = await db
    .from("users")
    .select("id, email, name, created_at, is_admin")
    .order("created_at", { ascending: true });

  const { data: keys } = await db
    .from("user_keys")
    .select("user_id, is_active")
    .eq("service", "claude");

  const keyMap = new Map((keys ?? []).map((k) => [k.user_id, k.is_active]));

  return NextResponse.json(
    (users ?? []).map((u) => ({
      ...u,
      claude_key_active: keyMap.get(u.id) ?? false,
    }))
  );
}
