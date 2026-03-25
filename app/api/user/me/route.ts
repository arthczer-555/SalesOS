import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [keyRow, gmailRow, userRow] = await Promise.all([
    db.from("user_keys").select("is_active").eq("user_id", user.id).eq("service", "claude").single(),
    db.from("user_integrations").select("connected").eq("user_id", user.id).eq("provider", "gmail").single(),
    db.from("users").select("slack_display_name").eq("id", user.id).single(),
  ]);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: user.is_admin,
    claude_key_active: keyRow.data?.is_active ?? false,
    gmail_connected: gmailRow.data?.connected ?? false,
    slack_display_name: userRow.data?.slack_display_name ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slack_display_name } = await req.json() as { slack_display_name: string };

  const { error } = await db
    .from("users")
    .update({ slack_display_name: slack_display_name || null })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
