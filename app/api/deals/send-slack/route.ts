import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function slackPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error}`);
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const { text } = await req.json() as { text: string };

    // Get user's slack_display_name from DB
    const { data: userRow } = await db
      .from("users")
      .select("slack_display_name")
      .eq("id", user.id)
      .single();

    const slackDisplayName = userRow?.slack_display_name?.trim();
    if (!slackDisplayName) {
      return NextResponse.json({ error: "User Slack non défini" }, { status: 400 });
    }

    // Find Slack member by display name or real name
    const listRes = await fetch(
      `https://slack.com/api/users.list?limit=200`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }
    );
    const listData = await listRes.json();
    if (!listData.ok) {
      return NextResponse.json({ error: "Impossible de récupérer les utilisateurs Slack" }, { status: 500 });
    }

    const needle = slackDisplayName.toLowerCase();
    const member = (listData.members ?? []).find((m: { deleted?: boolean; is_bot?: boolean; profile?: { real_name?: string; display_name?: string } }) => {
      if (m.deleted || m.is_bot) return false;
      const realName = (m.profile?.real_name ?? "").toLowerCase();
      const displayName = (m.profile?.display_name ?? "").toLowerCase();
      return realName.includes(needle) || displayName.includes(needle);
    });

    if (!member) {
      return NextResponse.json({ error: `Utilisateur Slack "${slackDisplayName}" introuvable` }, { status: 404 });
    }

    const dm = await slackPost("/conversations.open", { users: member.id });
    const channel = dm.channel.id;

    await slackPost("/chat.postMessage", { channel, text });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("deals/send-slack error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
