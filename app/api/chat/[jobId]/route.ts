import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/chat/[jobId] -> état de la job (polling depuis la barre de chat web).
// Scope par user_id : le chat est privé, on ne sert jamais la job d'un autre user.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { jobId } = await params;
  const { data, error } = await db
    .from("chat_jobs")
    .select("id, status, streaming_text, tool_steps, cost, history, final_text, error, updated_at")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ job: data });
}
