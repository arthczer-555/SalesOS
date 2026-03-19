import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, claudeKey } = await req.json();
  if (!userId || !claudeKey) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const { data: targetUser } = await db
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { encryptedKey, iv, authTag } = encrypt(claudeKey);

  await db.from("user_keys").upsert({
    user_id: userId,
    service: "claude",
    encrypted_key: encryptedKey,
    iv,
    auth_tag: authTag,
    is_active: true,
  });

  return NextResponse.json({ success: true });
}
