import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listSlackChannels } from "@/lib/agents/slack";

export const dynamic = "force-dynamic";

// GET /api/agents/slack-channels : canaux pour le sélecteur de destination,
// avec isMember (le bot doit être invité pour poster dans un canal).
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json({ channels: await listSlackChannels() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Slack unreachable" }, { status: 502 });
  }
}
