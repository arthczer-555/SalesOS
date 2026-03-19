import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: keyRow } = await db
    .from("user_keys")
    .select("is_active")
    .eq("user_id", user.id)
    .eq("service", "claude")
    .single();

  const { data: gmailRow } = await db
    .from("user_integrations")
    .select("connected")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .single();

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: user.is_admin,
    claude_key_active: keyRow?.is_active ?? false,
    gmail_connected: gmailRow?.connected ?? false,
  });
}
