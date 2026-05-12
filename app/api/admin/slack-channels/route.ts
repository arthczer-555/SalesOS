import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

interface SlackChannel {
  id: string;
  name: string;
  is_archived?: boolean;
  is_private?: boolean;
  is_member?: boolean;
}

/**
 * GET — Liste les canaux Slack accessibles au bot (public + private, non archivés).
 * Utilisé par l'éditeur d'alert config dans /admin pour proposer un dropdown.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "SLACK_BOT_TOKEN not set", channels: [] }, { status: 500 });

  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  try {
    do {
      const params = new URLSearchParams({
        limit: "200",
        types: "public_channel,private_channel",
        exclude_archived: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        channels?: SlackChannel[];
        response_metadata?: { next_cursor?: string };
      };
      if (!data.ok) {
        return NextResponse.json({ error: `Slack: ${data.error}`, channels: [] }, { status: 500 });
      }
      channels.push(...(data.channels ?? []));
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    channels.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({
      channels: channels.map((c) => ({ id: c.id, name: c.name, is_private: c.is_private ?? false })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), channels: [] }, { status: 500 });
  }
}
