import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await db
    .from("user_integrations")
    .select("connected")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .single();

  return NextResponse.json({ connected: data?.connected ?? false });
}
