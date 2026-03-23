import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "@/lib/log-usage";

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

  const { userContent, assistantContent, apiHistory, isFirst } = await req.json();

  const { error } = await db.from("conversation_messages").insert([
    { conversation_id: id, role: "user", content: userContent },
    { conversation_id: id, role: "assistant", content: assistantContent, api_history: apiHistory },
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Generate a title on the first exchange
  let generatedTitle: string | null = null;
  if (isFirst) {
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 30,
        system: "Generate a short title (4-6 words max, no quotes, no punctuation) that summarizes this conversation. Reply with only the title, nothing else.",
        messages: [
          { role: "user", content: `User asked: ${userContent}\n\nAssistant replied: ${assistantContent.slice(0, 300)}` },
        ],
      });
      generatedTitle = msg.content[0].type === "text" ? msg.content[0].text.trim() : null;
      logUsage(user.id, "claude-haiku-4-5-20251001", msg.usage.input_tokens, msg.usage.output_tokens);
    } catch { /* keep default title */ }
  }

  await db
    .from("conversations")
    .update({
      updated_at: new Date().toISOString(),
      ...(generatedTitle ? { title: generatedTitle } : {}),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, ...(generatedTitle ? { title: generatedTitle } : {}) });
}
