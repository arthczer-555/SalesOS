/**
 * Livraison Slack des agents + liste des canaux pour le sélecteur de
 * destination. Le message est posté par le bot CoachelloAI : en DM à l'owner
 * ou dans le canal choisi (le bot doit en être membre, sinon erreur explicite).
 */

import { toSlackMrkdwn } from "@/lib/slack/mrkdwn";
import { lookupSlackIdByEmail } from "@/lib/slack/lookup";
import { db } from "@/lib/db";
import { describeSchedule } from "./schedule";
import type { AgentRow } from "./types";

const SLACK = "https://slack.com/api";
// Limite Slack d'un bloc section : 3000 caractères. On garde une marge.
const SECTION_MAX = 2900;
// 50 blocs max par message : header + footer + 46 sections.
const MAX_SECTIONS = 46;

type SlackResponse = { ok: boolean; error?: string } & Record<string, unknown>;

async function slackCall(method: string, body: Record<string, unknown>): Promise<SlackResponse> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack is not configured (SLACK_BOT_TOKEN missing).");
  const res = await fetch(`${SLACK}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SlackResponse;
}

/** Erreurs Slack traduites en phrase actionnable (affichée dans l'historique des runs). */
function friendlySlackError(error: string | undefined, agent: AgentRow): string {
  const where = agent.destination.type === "channel" ? `#${agent.destination.channelName}` : "the DM";
  switch (error) {
    case "not_in_channel":
      return `CoachelloAI is not a member of ${where}. Type /invite @CoachelloAI in the channel, then run the agent again.`;
    case "channel_not_found":
      return `Slack channel ${where} was not found (deleted, renamed or private). Pick another destination.`;
    case "is_archived":
      return `Slack channel ${where} is archived. Pick another destination.`;
    case "msg_too_long":
      return "The message is too long for Slack. Ask for a shorter message in the instructions.";
    default:
      return `Slack refused the message (${error ?? "unknown error"}).`;
  }
}

/**
 * Découpe le mrkdwn en sections de moins de SECTION_MAX caractères, sur les
 * paragraphes puis les lignes. Un bloc de code coupé est refermé puis rouvert
 * pour rester lisible.
 */
export function splitForSlack(mrkdwn: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let inFence = false;
  const push = () => {
    if (!current.trim()) return;
    chunks.push(inFence ? `${current}\n\`\`\`` : current);
    current = inFence ? "```\n" : "";
  };
  for (const line of mrkdwn.split("\n")) {
    const pieces = line.length > SECTION_MAX ? line.match(new RegExp(`.{1,${SECTION_MAX}}`, "g")) ?? [line] : [line];
    for (const piece of pieces) {
      if (current.length + piece.length + 1 > SECTION_MAX) push();
      current += (current && !current.endsWith("\n") ? "\n" : "") + piece;
      if (/^```/.test(piece.trim())) inFence = !inFence;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
}

async function resolveDmChannel(ownerId: string): Promise<string> {
  const { data: user } = await db.from("users").select("email, slack_user_id").eq("id", ownerId).single();
  const memberId = user?.slack_user_id || (user?.email ? await lookupSlackIdByEmail(user.email) : null);
  if (!memberId) {
    throw new Error("Your Slack account could not be found. Set your Slack name in Settings, then run the agent again.");
  }
  const dm = await slackCall("conversations.open", { users: memberId });
  const channelId = (dm.channel as { id?: string } | undefined)?.id;
  if (!dm.ok || !channelId) throw new Error(`Could not open your Slack DM (${dm.error ?? "unknown error"}).`);
  return channelId;
}

export type SlackDelivery = { channel: string; ts: string; permalink: string | null };

/**
 * Poste le message final (markdown) de l'agent à sa destination. `dmUserId` :
 * run exécuté pour un collègue (abonné ou "Try it now"), livré dans SON DM
 * quelle que soit la destination de l'owner ; `sharedBy` le signale.
 */
export async function deliverAgentMessage(
  agent: AgentRow,
  markdown: string,
  opts: { dmUserId?: string; sharedBy?: string | null } = {},
): Promise<SlackDelivery> {
  // DM d'un tiers (abonné, "Try it now", membre d'une audience), sinon la
  // destination de l'agent. Une audience sans dmUserId = le DM de l'owner.
  const channel = opts.dmUserId
    ? await resolveDmChannel(opts.dmUserId)
    : agent.destination.type === "channel"
      ? agent.destination.channelId
      : await resolveDmChannel(agent.owner_id);

  const body = toSlackMrkdwn(markdown);
  let sections = splitForSlack(body);
  if (sections.length > MAX_SECTIONS) {
    sections = [...sections.slice(0, MAX_SECTIONS), "_(Message truncated: too long for Slack.)_"];
  }
  const url = appUrl();
  // Un destinataire ne gère pas l'agent : il l'ouvre (onglet Received).
  const manage = url ? ` · <${url}/agents/${agent.id}|${opts.dmUserId ? "Open agent" : "Manage agent"}>` : "";

  const blocks: Record<string, unknown>[] = [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${agent.emoji}  *${agent.name}*  ·  ${describeSchedule(agent.schedule)}${opts.sharedBy ? `  ·  from ${opts.sharedBy}` : ""}`,
        },
      ],
    },
    ...sections.map((text) => ({ type: "section", text: { type: "mrkdwn", text } })),
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `CoachelloHQ Agents${manage}` }],
    },
  ];

  const posted = await slackCall("chat.postMessage", {
    channel,
    // Texte de repli (notifications, aperçu mobile) : le nom de l'agent puis
    // le début du message.
    text: `${agent.emoji} ${agent.name}: ${body.replace(/\s+/g, " ").slice(0, 200)}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!posted.ok) throw new Error(friendlySlackError(posted.error, agent));

  const ts = String(posted.ts ?? "");
  const postedChannel = String(posted.channel ?? channel);
  let permalink: string | null = null;
  try {
    const res = await fetch(
      `${SLACK}/chat.getPermalink?channel=${encodeURIComponent(postedChannel)}&message_ts=${encodeURIComponent(ts)}`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } },
    );
    const data = (await res.json()) as { ok: boolean; permalink?: string };
    if (data.ok) permalink = data.permalink ?? null;
  } catch {
    /* best-effort : le message est posté, le lien est un bonus */
  }
  return { channel: postedChannel, ts, permalink };
}

// ── Canaux (sélecteur de destination) ──────────────────────────────────────

export type SlackChannelOption = { id: string; name: string; isPrivate: boolean; isMember: boolean };

let channelsCache: { data: SlackChannelOption[]; at: number } | null = null;
const CHANNELS_TTL_MS = 5 * 60 * 1000;

/**
 * Canaux visibles par le bot. Les canaux privés n'apparaissent que si le bot y
 * est déjà ; pour un canal public, isMember dit s'il faudra l'inviter.
 */
export async function listSlackChannels(): Promise<SlackChannelOption[]> {
  if (channelsCache && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.data;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack is not configured.");
  const all: SlackChannelOption[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${SLACK}/conversations.list`);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("exclude_archived", "true");
    url.searchParams.set("types", "public_channel,private_channel");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      channels?: { id: string; name: string; is_private?: boolean; is_member?: boolean }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) throw new Error(`Slack conversations.list: ${data.error ?? "unknown error"}`);
    for (const c of data.channels ?? []) {
      all.push({ id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  all.sort((a, b) => a.name.localeCompare(b.name));
  channelsCache = { data: all, at: Date.now() };
  return all;
}
