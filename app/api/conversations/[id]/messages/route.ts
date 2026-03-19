import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { userContent, assistantContent, apiHistory } = await req.json();

  const { error } = await db.from("conversation_messages").insert([
    { conversation_id: id, role: "user", content: userContent },
    { conversation_id: id, role: "assistant", content: assistantContent, api_history: apiHistory },
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
