import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { slackBotGet } from "@/lib/slack/search";
import { isSharedChannel, listChannels, matchClientChannels } from "@/lib/clients/slack-context";
import { triggerClientRefresh } from "@/lib/clients/trigger-refresh";
import { SLACK_APP_NAME, type ClientSlackChannel, type SlackChannelsResponse } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Canaux Slack dédiés d'une fiche (cf. lib/clients/slack-context.ts).
//
// GET : canaux du workspace pour le sélecteur (ceux qui ressemblent au nom de
//   la société en tête), avec ceux déjà reliés.
// POST { channel_id, action: "link" | "unlink" } :
//  - link : seulement si l'app CoachelloHQ est membre du canal (vérifié en
//    live). Le canal est relié à la main, sort des canaux retirés, puis un
//    refresh le lit sur 90 jours ;
//  - unlink : le canal n'est plus lu et n'est plus jamais relié
//    automatiquement à cette fiche. Pas de refresh (rien de nouveau à lire).

type ClientSlackRow = {
  id: string;
  company_name: string;
  enrichment_status: string;
  slack_channels?: ClientSlackChannel[] | null;
  declined_slack_channel_ids?: string[] | null;
};

const NOT_MIGRATED = "The database update for Slack channels is not applied yet.";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!process.env.SLACK_BOT_TOKEN) return NextResponse.json({ error: "Slack is not configured" }, { status: 500 });

  const { id } = await params;
  const { data: client, error: clientErr } = await db.from("clients").select("*").eq("id", id).single<ClientSlackRow>();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const listed = await listChannels();
  if (listed.error && listed.channels.length === 0) {
    return NextResponse.json({ error: `Could not list the Slack channels (${listed.error})` }, { status: 502 });
  }
  const suggested = new Set(matchClientChannels(listed.channels, client.company_name).map((c) => c.id));
  const channels = listed.channels
    .filter((c) => !isSharedChannel(c.name))
    .map((c) => ({ id: c.id, name: c.name, is_private: !!c.is_private, is_member: !!c.is_member, suggested: suggested.has(c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    linked: client.slack_channels ?? [],
    channels,
    supported: client.slack_channels !== undefined,
  } satisfies SlackChannelsResponse);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { channel_id?: unknown; action?: unknown };
  const channelId = typeof body.channel_id === "string" ? body.channel_id.trim() : "";
  const action = body.action === "link" || body.action === "unlink" ? body.action : null;
  if (!channelId || !action) return NextResponse.json({ error: "channel_id and action (link | unlink) required" }, { status: 400 });

  // select("*") : sans la migration, les colonnes n'existent pas et on le dit.
  const { data: client, error: clientErr } = await db.from("clients").select("*").eq("id", id).single<ClientSlackRow>();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (client.slack_channels === undefined) return NextResponse.json({ error: NOT_MIGRATED }, { status: 409 });

  const linked = client.slack_channels ?? [];
  const declined = new Set(client.declined_slack_channel_ids ?? []);
  const now = new Date().toISOString();

  if (action === "unlink") {
    declined.add(channelId);
    const { error } = await db
      .from("clients")
      .update({ slack_channels: linked.filter((c) => c.id !== channelId), declined_slack_channel_ids: [...declined], updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (linked.some((c) => c.id === channelId)) return NextResponse.json({ ok: true, refresh: "not_started" });

  // Vérification live : la liste affichée a pu changer (app retirée du canal).
  const info = await slackBotGet<{ channel?: { id: string; name: string; is_member?: boolean; is_archived?: boolean } }>(
    "/conversations.info",
    { channel: channelId },
  );
  if (!info.ok || !info.channel) {
    const notFound = !info.ok && info.error === "channel_not_found";
    return NextResponse.json(
      { error: notFound ? `Channel not found. A private channel only shows up once ${SLACK_APP_NAME} is in it.` : `Slack did not answer (${info.ok ? "no channel" : info.error})` },
      { status: notFound ? 404 : 502 },
    );
  }
  const channel = info.channel;
  if (isSharedChannel(channel.name)) {
    return NextResponse.json({ error: `#${channel.name} is already read for every account.` }, { status: 400 });
  }
  if (channel.is_archived) return NextResponse.json({ error: `#${channel.name} is archived.` }, { status: 409 });
  if (!channel.is_member) {
    return NextResponse.json(
      { error: `${SLACK_APP_NAME} is not in #${channel.name}. Add it to the channel in Slack first (/invite @${SLACK_APP_NAME}).` },
      { status: 409 },
    );
  }

  declined.delete(channelId);
  const entry: ClientSlackChannel = { id: channel.id, name: channel.name, source: "manual", linked_at: now, linked_by: user.email || null };
  const { error: updErr } = await db
    .from("clients")
    .update({ slack_channels: [...linked, entry], declined_slack_channel_ids: declined.size > 0 ? [...declined] : null, updated_at: now })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Le refresh ne tourne que sur une fiche enrichie : sinon le canal sera lu au premier refresh.
  if (client.enrichment_status !== "done") return NextResponse.json({ ok: true, refresh: "not_started" });
  try {
    const mode = await triggerClientRefresh(req.nextUrl.origin, id, user.id);
    return NextResponse.json({ ok: true, refresh: mode }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ ok: true, refresh: "not_started", error: e instanceof Error ? e.message : String(e) }, { status: 202 });
  }
}
