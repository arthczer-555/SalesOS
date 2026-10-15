/**
 * Outils Slack de CoachelloAI (extraits de l'ancien lib/chat/core.ts).
 *
 * Les canaux clés (lib/slack/key-channels.ts) sont décrits dans les
 * définitions : le modèle les connaît sans chercher. Un canal se désigne par
 * son nom ou son ID ; un canal introuvable ou illisible donne une erreur
 * explicite, jamais un "aucun message" indiscernable d'un canal vide.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolModule } from "./types";
import { toSlackMrkdwn } from "@/lib/slack/mrkdwn";
import { listSlackChannels } from "@/lib/agents/slack";
import { KEY_SLACK_CHANNELS, keyChannelByName, keyChannelsCatalog } from "@/lib/slack/key-channels";
import { botName, isSystemMessage, messageText, type RawSlackMessage } from "@/lib/slack/message-text";
import { parisDateTime, readPeriod } from "./period";

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

const CHANNEL_ID_RE = /^[CG][A-Z0-9]{6,}$/;

export type ResolvedChannel = { id: string; name: string; isPrivate: boolean; isMember: boolean };

/**
 * Nom (avec ou sans #) ou ID → canal lisible par le bot. Un ID (fourni ou
 * connu du registre) passe par conversations.info : c'est le seul moyen de
 * voir un canal privé sans scanner la liste. Sinon, la liste en cache.
 */
export async function resolveSlackChannel(raw: string): Promise<{ ok: true; channel: ResolvedChannel } | { ok: false; error: string }> {
  const input = raw.trim().replace(/^#/, "");
  const id = CHANNEL_ID_RE.test(input) ? input : keyChannelByName(input)?.id;
  if (id) {
    try {
      const info = await slack("/conversations.info", { channel: id });
      const c = info.channel as { id: string; name: string; is_private?: boolean; is_member?: boolean };
      return { ok: true, channel: { id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("channel_not_found")) return { ok: false, error: `Lecture du canal "${raw}" impossible (${msg}).` };
      return {
        ok: false,
        error: `Canal "${raw}" illisible : il est privé et CoachelloAI n'y a pas été invité, ou il n'existe plus. Pour le débloquer, il faut taper /invite @CoachelloAI dans le canal.`,
      };
    }
  }
  const all = await listSlackChannels();
  const c = all.find((ch) => ch.name.toLowerCase() === input.toLowerCase());
  if (!c) {
    return {
      ok: false,
      error: `Canal "${raw}" introuvable parmi les canaux visibles par CoachelloAI (un canal privé n'est visible que si le bot y a été invité). Utilise list_slack_channels pour trouver le bon nom.`,
    };
  }
  return { ok: true, channel: c };
}

function notMemberError(channel: ResolvedChannel): string {
  return `CoachelloAI n'est pas membre de #${channel.name} : impossible de lire son historique. Pour le débloquer, il faut taper /invite @CoachelloAI dans le canal.`;
}

/**
 * Messages top-level d'un canal sur [oldestSec, latestSec] (toutes les pages),
 * événements système exclus. `deadline` coupe proprement avant un timeout.
 */
export async function fetchChannelMessages(
  channelId: string,
  opts: { oldestSec?: number; latestSec?: number; cap?: number; deadlineMs?: number } = {},
): Promise<{ messages: RawSlackMessage[]; truncated: boolean }> {
  const cap = opts.cap ?? Infinity;
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const messages: RawSlackMessage[] = [];
  let cursor: string | undefined;
  let truncated = false;
  do {
    const params: Record<string, string> = { channel: channelId, limit: "200" };
    if (opts.oldestSec != null) params.oldest = String(opts.oldestSec);
    if (opts.latestSec != null) params.latest = String(opts.latestSec);
    if (cursor) params.cursor = cursor;
    const data = await slack("/conversations.history", params);
    for (const m of (data.messages ?? []) as RawSlackMessage[]) {
      if (!isSystemMessage(m)) messages.push(m);
    }
    cursor = data.response_metadata?.next_cursor || undefined;
    if (cursor && Date.now() >= deadline) { truncated = true; break; }
  } while (cursor && messages.length < cap);
  return { messages: cap === Infinity ? messages : messages.slice(0, cap), truncated: truncated || messages.length > cap };
}

/** user id → nom réel, en parallèle, best-effort. */
export async function resolveUserNames(userIds: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all([...new Set(userIds)].map(async (uid) => {
    try {
      const u = await slack("/users.info", { user: uid });
      map[uid] = u.user?.real_name ?? u.user?.name ?? uid;
    } catch { map[uid] = uid; }
  }));
  return map;
}

// Canaux fouillés par search_slack quand aucun n'est précisé : les canaux clés
// sauf le flux des bookings (des dizaines de notifications par jour, il
// noierait la recherche), plus #general.
const DEFAULT_SEARCH_CHANNELS = [
  "general",
  ...KEY_SLACK_CHANNELS.filter((c) => c.name !== "2x-booking-notifications").map((c) => c.name),
];

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "search_slack",
    description:
      `Recherche des messages Slack par mot-clé dans un ou plusieurs canaux (nom ou ID). Réservé à l'approfondissement de 1 à 3 deals/comptes déjà identifiés : JAMAIS en recherche de masse (pas de boucle Slack sur 20 deals). Les canaux clients dédiés existent (ex: #engie, #adyen, #salomon) : cible-les pour un compte précis. Sans canal précisé : ${DEFAULT_SEARCH_CHANNELS.map((c) => `#${c}`).join(", ")}. Les canaux introuvables ou illisibles sont signalés dans la réponse.`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés à rechercher (insensible à la casse)" },
        channels: { type: "array", items: { type: "string" }, description: "Canaux où chercher : nom sans # ou ID (ex: C05S20AHV0D)." },
        limit: { type: "number", description: "Nombre de messages à analyser par canal (défaut : 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_slack_channel_history",
    description:
      `Récupère les messages d'un canal Slack (toutes les pages), sur une période avec date_from / date_to (jours en heure de Paris, bornes incluses). Sans dates, remonte TOUT l'historique : lourd, réserve-le aux questions qui l'exigent. Les événements système (arrivées, départs) sont ignorés ; le contenu des messages de bots (formulaires, notifications HubSpot ou plateforme) est inclus. Le canal se désigne par son nom ou son ID.\n\nCanaux clés de Coachello (utilisables directement, sans les chercher) :\n${keyChannelsCatalog()}\n\nPour compter des leads entrants ou des bookings de coaching, préfère get_inbound_leads et get_coaching_bookings (comptes calculés en code). Pour les meetings déclarés par commercial, get_sales_activity donne aussi le détail par rep.`,
    input_schema: {
      type: "object" as const,
      properties: {
        channel_name: { type: "string", description: "Nom du canal sans # (ex: 1a-new-incoming-leads) ou ID (ex: C05S20AHV0D)." },
        date_from: { type: "string", description: "Premier jour inclus, YYYY-MM-DD (heure de Paris). Ex : lundi de la semaine visée." },
        date_to: { type: "string", description: "Dernier jour inclus, YYYY-MM-DD. Défaut : aujourd'hui (si date_from est fourni)." },
        limit: { type: "number", description: "Plafond optionnel sur le nombre total de messages." },
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
  {
    name: "list_slack_channels",
    description:
      `Liste les canaux Slack visibles par CoachelloAI : nom, ID, privé ou non, bot membre ou non, description. À utiliser pour trouver un canal qui n'est pas dans les canaux clés (ex: canal dédié d'un client) avant get_slack_channel_history ou search_slack. Un canal privé n'apparaît que si le bot y a été invité ; un canal public dont le bot n'est pas membre est listé mais illisible tant qu'on ne l'invite pas.\n\nCanaux clés (déjà connus, inutile de les chercher) :\n${keyChannelsCatalog()}`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Filtre optionnel : morceau du nom ou de la description (ex: 'lead', 'adyen')." },
      },
      required: [],
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
        : DEFAULT_SEARCH_CHANNELS;
      const perChannelLimit = String(input.limit ?? 50);
      const results: { channel: string; text: string; user: string; timestamp: string }[] = [];
      const searched: string[] = [];
      const problems: string[] = [];
      await Promise.allSettled(targetChannels.map(async (chName) => {
        const resolved = await resolveSlackChannel(chName);
        if (!resolved.ok) { problems.push(`${chName} (introuvable ou privé sans le bot)`); return; }
        const ch = resolved.channel;
        if (!ch.isMember) { problems.push(`#${ch.name} (bot non membre, /invite @CoachelloAI)`); return; }
        try {
          const histData = await slack("/conversations.history", { channel: ch.id, limit: perChannelLimit });
          const msgs = ((histData.messages ?? []) as RawSlackMessage[]).filter((m) => !isSystemMessage(m));
          const matching = msgs.filter((m) => messageText(m).toLowerCase().includes(query));
          const userMap = await resolveUserNames(matching.map((m) => m.user).filter((u): u is string => !!u));
          searched.push(`#${ch.name}`);
          for (const m of matching) {
            results.push({
              channel: ch.name,
              text: messageText(m),
              user: m.user ? (userMap[m.user] ?? m.user) : botName(m) ?? "bot",
              timestamp: new Date(parseFloat(m.ts ?? "0") * 1000).toISOString(),
            });
          }
        } catch (e) {
          problems.push(`#${ch.name} (${e instanceof Error ? e.message : "lecture impossible"})`);
        }
      }));
      const notes = problems.length ? `\n\nCanaux NON consultés : ${problems.join(" ; ")}.` : "";
      if (results.length === 0) {
        return `Aucun message contenant "${input.query}" dans les canaux consultés (${searched.join(", ") || "aucun"}).${notes}`;
      }
      return JSON.stringify(results) + notes;
    },

    get_slack_channel_history: async (input) => {
      const resolved = await resolveSlackChannel(String(input.channel_name ?? ""));
      if (!resolved.ok) return resolved.error;
      const channel = resolved.channel;
      if (!channel.isMember) return notMemberError(channel);

      let oldestSec: number | undefined;
      let latestSec: number | undefined;
      let period: { from: string; to: string } | null = null;
      if (input.date_from != null) {
        const p = readPeriod(input);
        if (!p.ok) return p.error;
        oldestSec = Math.floor(p.startMs / 1000);
        latestSec = Math.ceil(p.endMs / 1000);
        period = { from: p.from, to: p.to };
      }
      const cap = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined;
      const { messages: raw, truncated } = await fetchChannelMessages(channel.id, { oldestSec, latestSec, cap });

      const userMap = await resolveUserNames(raw.map((m) => m.user).filter((u): u is string => !!u));
      const messages = raw.map((m) => ({
        text: messageText(m),
        user: m.user ? (userMap[m.user] ?? m.user) : botName(m) ?? "bot",
        timestamp: parisDateTime(parseFloat(m.ts ?? "0") * 1000),
        ...(m.thread_ts && m.thread_ts !== m.ts ? { thread_reply: true } : {}),
      }));
      return JSON.stringify({
        channel: channel.name,
        channel_id: channel.id,
        ...(period ? { period: { ...period, timezone: "Europe/Paris" } } : {}),
        total: messages.length,
        truncated,
        messages,
      });
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
        const resolved = await resolveSlackChannel(target);
        if (!resolved.ok) return resolved.error;
        channelId = resolved.channel.id;
      }
      await slackPost("/chat.postMessage", {
        channel: channelId,
        text: toSlackMrkdwn(input.message as string),
      });
      return `Message envoyé dans "${target}".`;
    },

    list_slack_channels: async (input) => {
      const all = await listSlackChannels();
      const q = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      const byId = new Map(all.map((c) => [c.id, c]));
      const keyIds = new Set(KEY_SLACK_CHANNELS.map((c) => c.id));

      const key = KEY_SLACK_CHANNELS.map((k) => {
        const seen = byId.get(k.id);
        return {
          name: k.name,
          id: k.id,
          key_channel: true,
          purpose: k.purpose,
          // Un canal privé absent de la liste = bot pas invité.
          bot_member: seen ? seen.isMember : false,
          ...(seen ? { private: seen.isPrivate } : { visible_to_bot: false }),
        };
      }).filter((c) => !q || c.name.includes(q) || c.purpose.toLowerCase().includes(q));

      const others = all
        .filter((c) => !keyIds.has(c.id))
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.purpose ?? "").toLowerCase().includes(q))
        .map((c) => ({
          name: c.name,
          id: c.id,
          private: c.isPrivate,
          bot_member: c.isMember,
          ...(c.purpose ? { purpose: c.purpose.slice(0, 160) } : {}),
        }));

      return JSON.stringify({
        total: key.length + others.length,
        note: "bot_member=false : canal illisible tant que CoachelloAI n'y est pas invité (/invite @CoachelloAI). Les canaux privés où le bot n'est pas n'apparaissent pas.",
        channels: [...key, ...others],
      });
    },
  },
};

export const slackTools = module_;
