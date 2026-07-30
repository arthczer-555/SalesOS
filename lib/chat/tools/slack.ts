/**
 * Outils Slack de CoachelloGPT (extraits de l'ancien lib/chat/core.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolModule } from "./types";
import { toSlackMrkdwn } from "@/lib/slack/mrkdwn";

// ── Helpers API ──────────────────────────────────────────────────────────────

async function slack(path: string, params?: Record<string, string>) {
  const url = new URL(`https://slack.com/api${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error}`);
  return data;
}

async function slackAllChannels(): Promise<{ name: string; id: string }[]> {
  const all: { name: string; id: string }[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "1000", types: "public_channel,private_channel" };
    if (cursor) params.cursor = cursor;
    const data = await slack("/conversations.list", params);
    all.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return all;
}

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

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "search_slack",
    description:
      "Recherche des messages Slack par mot-clé dans un ou plusieurs canaux. Réservé à l'approfondissement de 1 à 3 deals/comptes déjà identifiés : JAMAIS en recherche de masse (pas de boucle Slack sur 20 deals). Les canaux clients dédiés existent (ex: #engie, #adyen, #salomon) : cible-les pour un compte précis.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés à rechercher (insensible à la casse)" },
        channels: { type: "array", items: { type: "string" }, description: "Canaux où chercher (sans #)." },
        limit: { type: "number", description: "Nombre de messages à analyser par canal (défaut : 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_slack_channel_history",
    description:
      "Récupère l'historique COMPLET d'un canal Slack (toutes les pages via pagination, pas seulement les 100 derniers messages). Par défaut, remonte tout l'historique accessible.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_name: { type: "string", description: "Nom du canal sans #" },
        limit: { type: "number", description: "Plafond optionnel sur le nombre total de messages. Si omis, remonte TOUT l'historique du canal." },
      },
      required: ["channel_name"],
    },
  },
  {
    name: "send_slack_message",
    description:
      "Envoie un message dans un canal Slack ou en DM à un utilisateur. UNIQUEMENT sur demande explicite de l'utilisateur, et TOUJOURS après lui avoir demandé confirmation du contenu et du destinataire.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "Nom du canal sans # (ex: sales) ou email de l'utilisateur pour un DM" },
        message: { type: "string", description: "Contenu du message à envoyer" },
      },
      required: ["channel", "message"],
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    search_slack: async (input) => {
      const query = (input.query as string).toLowerCase();
      const targetChannels = (input.channels as string[] | undefined)?.length
        ? input.channels as string[]
        : ["general", "1y-new-meetings", "1a-new-incoming-leads", "10-sales-intelligence", "11-everything-prospects", "12-everything-clients"];
      const perChannelLimit = String(input.limit ?? 50);
      const allChannels = await slackAllChannels();
      const channelMap = new Map(allChannels.map((c) => [c.name, c.id]));
      const results: { channel: string; text: string; user: string; timestamp: string }[] = [];
      await Promise.allSettled(targetChannels.map(async (chName) => {
        const chId = channelMap.get(chName.replace("#", ""));
        if (!chId) return;
        try {
          const histData = await slack("/conversations.history", { channel: chId, limit: perChannelLimit });
          const userIds = [...new Set((histData.messages ?? []).map((m: { user?: string }) => m.user).filter(Boolean))] as string[];
          const userMap: Record<string, string> = {};
          await Promise.allSettled(userIds.map(async (uid) => {
            try { const u = await slack("/users.info", { user: uid }); userMap[uid] = u.user?.real_name ?? uid; } catch { userMap[uid] = uid; }
          }));
          for (const m of (histData.messages ?? []) as { text: string; ts: string; user?: string }[]) {
            if (m.text?.toLowerCase().includes(query)) {
              results.push({
                channel: chName,
                text: m.text,
                user: m.user ? (userMap[m.user] ?? m.user) : "bot",
                timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
              });
            }
          }
        } catch { /* canal inaccessible */ }
      }));
      if (results.length === 0) return `Aucun message contenant "${input.query}" trouvé dans les canaux consultés.`;
      return JSON.stringify(results);
    },

    get_slack_channel_history: async (input) => {
      const allChannels = await slackAllChannels();
      const searched = (input.channel_name as string).replace("#", "");
      const channel = allChannels.find((c) => c.name === searched);
      if (!channel) {
        const available = allChannels.map((c) => c.name).sort().join(", ");
        return `Canal "${searched}" introuvable. Canaux accessibles : ${available}`;
      }
      // On remonte TOUT l'historique du canal via pagination cursor (pas seulement la dernière page).
      // `limit` (optionnel) plafonne le nombre total de messages ; sinon on remonte tout.
      const cap = typeof input.limit === "number" && input.limit > 0 ? input.limit : Infinity;
      const deadline = Date.now() + 45_000; // garde-fou anti-timeout
      const rawMessages: { text: string; ts: string; user?: string }[] = [];
      let cursor: string | undefined;
      let truncated = false;
      do {
        const params: Record<string, string> = { channel: channel.id, limit: "200" };
        if (cursor) params.cursor = cursor;
        const histData = await slack("/conversations.history", params);
        rawMessages.push(...((histData.messages ?? []) as { text: string; ts: string; user?: string }[]));
        cursor = histData.response_metadata?.next_cursor || undefined;
        if (cursor && Date.now() >= deadline) { truncated = true; break; }
      } while (cursor && rawMessages.length < cap);
      const trimmed = cap === Infinity ? rawMessages : rawMessages.slice(0, cap);
      const userIds = [...new Set(trimmed.map((m) => m.user).filter(Boolean))] as string[];
      const userMap: Record<string, string> = {};
      await Promise.all(userIds.map(async (uid) => {
        try {
          const u = await slack("/users.info", { user: uid });
          userMap[uid] = u.user?.real_name ?? u.user?.name ?? uid;
        } catch { userMap[uid] = uid; }
      }));
      const messages = trimmed.map((m) => ({
        text: m.text,
        user: m.user ? (userMap[m.user] ?? m.user) : "bot",
        timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
      }));
      return JSON.stringify({ channel: channel.name, total: messages.length, truncated, messages });
    },

    send_slack_message: async (input) => {
      const target = input.channel as string;
      let channelId = target;
      if (target.includes("@")) {
        const usersData = await slack("/users.lookupByEmail", { email: target });
        const userId = usersData.user?.id;
        if (!userId) return `Utilisateur avec l'email "${target}" introuvable dans Slack.`;
        const dmData = await slackPost("/conversations.open", { users: userId });
        channelId = dmData.channel?.id;
      } else {
        const allChs = await slackAllChannels();
        const ch = allChs.find((c) => c.name === target.replace("#", ""));
        if (!ch) return `Canal "${target}" introuvable.`;
        channelId = ch.id;
      }
      await slackPost("/chat.postMessage", {
        channel: channelId,
        text: toSlackMrkdwn(input.message as string),
      });
      return `Message envoyé dans "${target}".`;
    },
  },
};

export const slackTools = module_;
