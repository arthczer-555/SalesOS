import { isNoisySlackChannel, searchSlackMessages, slackBotGet } from "@/lib/slack/search";
import { SLACK_APP_NAME, type ClientSlackChannel } from "./types";

// Activité Slack d'un client pour le refresh : (1) les canaux dédiés au client
// (#engie, #adyen, #coachello-adyen…), reliés à la fiche (clients.slack_channels)
// et lus en entier via le bot. Un canal n'est dédié que si l'app CoachelloHQ en
// est membre : le refresh relie tout seul les canaux dont le nom ressemble à la
// société et où l'app est présente (jusqu'à 3, un client a souvent un ancien et
// un nouveau canal), on peut aussi en relier un à la main depuis la fiche. Ceux
// où l'app n'est pas sont remontés dans `unjoined` ("invite CoachelloHQ"), pas
// lus : pas d'auto-join (visible de tous les membres) ni de lecture détournée
// par le user token ;
// (2) les canaux partagés lus par défaut (#12-everything-clients : recaps de
// meetings, échanges d'équipe sur tous les clients) : messages qui citent la
// société + TOUT leur thread (les réponses ne la nomment pas forcément) ;
// (3) les mentions de la société ailleurs dans le workspace.
// Best-effort : chaque échec est remonté dans `errors` pour être affiché dans
// le refresh report ("Slack not reachable") plutôt que confondu avec 0 message.

export type ClientSlackMessage = {
  channel: string; // nom sans #
  ts: string;
  date: string; // ISO
  author: string;
  text: string;
  in_client_channel: boolean;
};

export type ClientSlackActivity = {
  // Canaux dédiés lus : ceux reliés à la fiche (noms à jour) + ceux reliés
  // automatiquement à ce passage.
  channels: ClientSlackChannel[];
  // Reliés automatiquement à ce passage, à enregistrer sur la fiche.
  added: ClientSlackChannel[];
  // Canaux lus pour la première fois (reliés depuis le dernier passage) : tout
  // leur historique sur la fenêtre est nouveau pour la fiche.
  firstRead: string[];
  // Canaux qui ressemblent au compte mais où l'app n'est pas.
  unjoined: Array<{ id: string; name: string }>;
  messages: ClientSlackMessage[];
  errors: string[];
};

type ListedChannel = { id: string; name: string; is_private?: boolean; is_member?: boolean };

const RECENT_DAYS = 45;
const FIRST_READ_DAYS = 90;
const MAX_CHANNEL_MESSAGES = 200;
const MAX_THREADS = 15;
const MAX_SEARCH_RESULTS = 30;
const MAX_AUTHORS_RESOLVED = 25;
const MAX_AUTO_CHANNELS = 3;
// Canaux d'équipe lus pour chaque client (filtrés sur les mentions du client).
const DEFAULT_SHARED_CHANNELS = ["12-everything-clients"];
const MAX_SHARED_PAGES = 4; // 4 x 200 messages sur la fenêtre

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Le message cite-t-il la société ? Nom complet (sans les mots génériques), ou
// premier mot distinctif d'au moins 4 lettres en mot entier ("allianz").
export function mentionsCompany(text: string, companyName: string): boolean {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return false;
  const t = normalize(text);
  if (t.includes(tokens.join(" "))) return true;
  const first = tokens[0];
  if (first.length < 4) return false;
  return new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(t);
}

// Mots trop génériques pour identifier un canal client à partir du nom légal.
const GENERIC_TOKENS = new Set([
  "group", "groupe", "sa", "sas", "sasu", "inc", "ltd", "llc", "gmbh", "plc", "bv", "ag", "spa",
  "the", "le", "la", "les", "et", "and", "company", "corp", "corporation", "holding",
  "france", "international", "global", "services", "solutions",
]);

function companyTokens(companyName: string): string[] {
  return companyName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

// Score de correspondance nom de canal <-> société. 0 = pas de match.
// 3 : slug complet ("lumen-retail") ; 2 : premier mot distinctif seul
// ("lumen") ; 1 : le canal contient le slug ou le premier mot comme segment
// ("client-lumen", "lumen-onboarding").
export function channelMatchScore(channelName: string, companyName: string): number {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return 0;
  const slug = tokens.join("-");
  const first = tokens[0];
  const name = channelName.toLowerCase();
  const segments = name.split(/[-_]+/);
  if (name === slug || name === tokens.join("")) return 3;
  if (first.length >= 3 && name === first) return 2;
  if (name.includes(slug) && slug.length >= 4) return 1;
  if (first.length >= 4 && segments.includes(first)) return 1;
  return 0;
}

// Canaux visibles du bot : tous les publics (is_member dit s'il y est) et les
// privés dont il est membre. Sert aussi au sélecteur de la fiche.
export async function listChannels(): Promise<{ channels: ListedChannel[]; error: string | null }> {
  const all: ListedChannel[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      limit: "1000",
      types: "public_channel,private_channel",
      exclude_archived: "true",
    };
    if (cursor) params.cursor = cursor;
    const data = await slackBotGet<{
      channels?: ListedChannel[];
      response_metadata?: { next_cursor?: string };
    }>("/conversations.list", params);
    if (!data.ok) return { channels: all, error: data.error };
    all.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return { channels: all, error: null };
}

// Canaux dont le nom ressemble à la société, du plus proche au moins proche.
export function matchClientChannels<T extends { id: string; name: string }>(all: T[], companyName: string): T[] {
  return all
    .map((ch) => ({ ch, score: channelMatchScore(ch.name, companyName) }))
    .filter(({ ch, score }) => score > 0 && !isNoisySlackChannel(ch.name) && !isSharedChannel(ch.name))
    .sort((a, b) => b.score - a.score || a.ch.name.length - b.ch.name.length)
    .map(({ ch }) => ch);
}

// #12-everything-clients est lu pour tous les clients : jamais "dédié".
export function isSharedChannel(name: string): boolean {
  return DEFAULT_SHARED_CHANNELS.includes(name);
}

// Message d'erreur lisible pour un canal relié qu'on n'a pas pu lire.
function channelReadError(name: string, error: string): string {
  if (error === "not_in_channel") return `${SLACK_APP_NAME} is no longer in #${name}: invite it back to read the channel, or unlink it.`;
  if (error === "channel_not_found") return `#${name} was deleted, or ${SLACK_APP_NAME} can no longer see it.`;
  return `Could not read #${name} (${error})`;
}

type RawSlackMessage = {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  subtype?: string;
  reply_count?: number;
  latest_reply?: string;
  bot_profile?: { name?: string };
};

// Messages système sans contenu utile pour la fiche.
const SKIPPED_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name", "pinned_item"]);

function tsToIso(ts: string): string {
  const n = Number(ts);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

async function readChannel(
  channelId: string,
  oldestTs: number,
): Promise<{ raw: RawSlackMessage[]; error: string | null }> {
  const params = { channel: channelId, oldest: String(oldestTs), limit: String(MAX_CHANNEL_MESSAGES) };
  // Pas d'auto-join : rejoindre un canal client est visible de tous ses membres.
  // Bot non membre = erreur not_in_channel, affichée ("invite the bot").
  const history = await slackBotGet<{ messages?: RawSlackMessage[] }>("/conversations.history", params);
  if (!history.ok) return { raw: [], error: history.error };

  const top = (history.messages ?? []).filter((m) => !m.subtype || !SKIPPED_SUBTYPES.has(m.subtype));
  const raw: RawSlackMessage[] = [...top];

  // Threads actifs sur la période : les réponses portent souvent l'info clé.
  const threads = top
    .filter((m) => (m.reply_count ?? 0) > 0 && m.ts && Number(m.latest_reply ?? 0) > oldestTs)
    .slice(0, MAX_THREADS);
  for (const t of threads) {
    const replies = await slackBotGet<{ messages?: RawSlackMessage[] }>("/conversations.replies", {
      channel: channelId,
      ts: t.ts as string,
      oldest: String(oldestTs),
      limit: "50",
    });
    if (!replies.ok) continue;
    // Le 1er message de conversations.replies est le parent, déjà présent.
    raw.push(...(replies.messages ?? []).filter((r) => r.ts !== t.ts));
  }
  return { raw, error: null };
}

// Canal partagé (#12-everything-clients) : on ne garde que les messages qui
// citent la société, avec tout leur thread.
async function readSharedChannel(
  channelId: string,
  oldestTs: number,
  companyName: string,
): Promise<{ raw: RawSlackMessage[]; error: string | null }> {
  const top: RawSlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SHARED_PAGES; page++) {
    const params: Record<string, string> = { channel: channelId, oldest: String(oldestTs), limit: "200" };
    if (cursor) params.cursor = cursor;
    const history = await slackBotGet<{ messages?: RawSlackMessage[]; response_metadata?: { next_cursor?: string } }>(
      "/conversations.history",
      params,
    );
    if (!history.ok) return { raw: [], error: history.error };
    top.push(...(history.messages ?? []));
    cursor = history.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  const matching = top.filter((m) => (!m.subtype || !SKIPPED_SUBTYPES.has(m.subtype)) && m.text && mentionsCompany(m.text, companyName));
  const raw: RawSlackMessage[] = [...matching];
  for (const t of matching.filter((m) => (m.reply_count ?? 0) > 0 && m.ts).slice(0, MAX_THREADS)) {
    const replies = await slackBotGet<{ messages?: RawSlackMessage[] }>("/conversations.replies", {
      channel: channelId,
      ts: t.ts as string,
      limit: "50",
    });
    if (!replies.ok) continue;
    raw.push(...(replies.messages ?? []).filter((r) => r.ts !== t.ts));
  }
  return { raw, error: null };
}

async function resolveAuthors(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids.slice(0, MAX_AUTHORS_RESOLVED)) {
    const info = await slackBotGet<{ user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } } }>(
      "/users.info",
      { user: id },
    );
    if (!info.ok) continue;
    const name = info.user?.real_name || info.user?.profile?.real_name || info.user?.profile?.display_name;
    if (name) out.set(id, name);
  }
  return out;
}

export async function fetchClientSlackActivity(opts: {
  companyName: string;
  // Dernier passage du refresh : sert à choisir la fenêtre (45 j, ou 90 j au
  // tout premier passage). Le "nouveau" est compté par l'appelant.
  lastReadAt?: string | null;
  // Canaux reliés à la fiche et retirés à la main (jamais re-reliés). linked
  // undefined = migration clients_slack_channels.sql absente : les canaux
  // trouvés sont lus mais ne sont pas reliés (rien à enregistrer).
  linked?: ClientSlackChannel[];
  declinedIds?: string[];
}): Promise<ClientSlackActivity> {
  const errors: string[] = [];
  if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_USER_TOKEN) {
    return { channels: [], added: [], firstRead: [], unjoined: [], messages: [], errors: ["Slack is not configured"] };
  }

  const days = opts.lastReadAt ? RECENT_DAYS : FIRST_READ_DAYS;
  const oldestMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const oldestTs = Math.floor(oldestMs / 1000);
  const firstReadOldestTs = Math.floor((Date.now() - FIRST_READ_DAYS * 24 * 60 * 60 * 1000) / 1000);

  // ── Canaux dédiés : reliés à la fiche + trouvés à ce passage ─────────────
  const listed = process.env.SLACK_BOT_TOKEN ? await listChannels() : { channels: [], error: null };
  if (listed.error && listed.channels.length === 0) errors.push(`Slack channel lookup failed (${listed.error})`);
  const listedById = new Map(listed.channels.map((c) => [c.id, c]));
  const persist = opts.linked !== undefined;
  // Nom à jour (un canal renommé garde son id).
  const linked = (opts.linked ?? []).map((c) => {
    const live = listedById.get(c.id);
    return live && live.name !== c.name ? { ...c, name: live.name } : c;
  });
  const linkedIds = new Set(linked.map((c) => c.id));
  const declined = new Set(opts.declinedIds ?? []);
  const matches = matchClientChannels(listed.channels, opts.companyName).filter((c) => !linkedIds.has(c.id) && !declined.has(c.id));
  const now = new Date().toISOString();
  const added: ClientSlackChannel[] = matches
    .filter((c) => c.is_member)
    .slice(0, Math.max(0, MAX_AUTO_CHANNELS - linked.length))
    .map((c) => ({ id: c.id, name: c.name, source: "auto", linked_at: now }));
  const unjoined = matches
    .filter((c) => !c.is_member)
    .slice(0, MAX_AUTO_CHANNELS)
    .map((c) => ({ id: c.id, name: c.name }));
  const channels = [...linked, ...added];
  const clientChannelNames = new Set(channels.map((c) => c.name));

  // Relié depuis le dernier passage : jamais lu, on remonte sur 90 jours. Sans
  // migration, rien n'est relié : pas de "première lecture" à chaque passage.
  const lastReadMs = opts.lastReadAt ? new Date(opts.lastReadAt).getTime() : null;
  const firstRead = persist
    ? channels.filter((c) => lastReadMs === null || new Date(c.linked_at).getTime() > lastReadMs).map((c) => c.name)
    : [];

  const raws: Array<{ m: RawSlackMessage; channel: string; inClient: boolean; minTs: number }> = [];
  const after = new Date(oldestMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const channel of channels) {
    const minTs = firstRead.includes(channel.name) ? firstReadOldestTs : oldestTs;
    const res = await readChannel(channel.id, minTs);
    if (res.error) {
      errors.push(channelReadError(channel.name, res.error));
      continue;
    }
    for (const m of res.raw) raws.push({ m, channel: channel.name, inClient: true, minTs });
  }

  // ── Canaux partagés lus par défaut (#12-everything-clients) ──────────────
  const sharedNames = new Set<string>();
  for (const name of DEFAULT_SHARED_CHANNELS) {
    if (clientChannelNames.has(name)) continue;
    sharedNames.add(name);
    const ch = listed.channels.find((c) => c.name === name);
    const viaBot = ch ? await readSharedChannel(ch.id, oldestTs, opts.companyName) : { raw: [], error: "channel_not_visible" };
    if (!viaBot.error) {
      for (const m of viaBot.raw) raws.push({ m, channel: name, inClient: false, minTs: oldestTs });
      continue;
    }
    const viaSearch = await searchSlackMessages(`in:#${name} "${opts.companyName}"`, { after, count: 50 });
    if (!viaSearch.error) {
      for (const m of viaSearch.messages) raws.push({ m: { ts: m.timestamp, text: m.text, user: m.user }, channel: name, inClient: false, minTs: oldestTs });
    } else {
      errors.push(`Could not read #${name} (${viaBot.error})`);
    }
  }

  // ── Mentions ailleurs dans le workspace ───────────────────────────────────
  const searched = await searchSlackMessages(`"${opts.companyName}"`, { after, count: MAX_SEARCH_RESULTS });
  if (searched.error && searched.error !== "slack_user_token_missing") {
    errors.push(`Slack search failed (${searched.error})`);
  }
  for (const m of searched.messages) {
    if (clientChannelNames.has(m.channel) || sharedNames.has(m.channel)) continue; // déjà lu plus haut
    if (isNoisySlackChannel(m.channel)) continue;
    raws.push({ m: { ts: m.timestamp, text: m.text, user: m.user }, channel: m.channel, inClient: false, minTs: oldestTs });
  }

  // Dédup par (canal, ts), filtre texte vide, tri du plus récent au plus ancien.
  const seen = new Set<string>();
  const unique = raws.filter(({ m, channel: ch, minTs }) => {
    if (!m.ts || !m.text?.trim()) return false;
    const key = `${ch}:${m.ts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Number(m.ts) >= minTs;
  });
  unique.sort((a, b) => Number(b.m.ts) - Number(a.m.ts));

  const authorIds = [...new Set(unique.map(({ m }) => m.user).filter((u): u is string => !!u && /^[UW][A-Z0-9]+$/.test(u)))];
  const authors = authorIds.length > 0 && process.env.SLACK_BOT_TOKEN ? await resolveAuthors(authorIds) : new Map<string, string>();

  const messages: ClientSlackMessage[] = unique.map(({ m, channel: ch, inClient }) => ({
    channel: ch,
    ts: m.ts as string,
    date: tsToIso(m.ts as string),
    author: (m.user && authors.get(m.user)) || m.bot_profile?.name || m.username || m.user || "unknown",
    text: (m.text ?? "").slice(0, 1500),
    in_client_channel: inClient,
  }));

  return { channels, added: persist ? added : [], firstRead, unjoined, messages, errors };
}

// Rendu prompt : du plus récent au plus ancien, budget ~25k caractères.
export function renderSlackForPrompt(messages: ClientSlackMessage[]): string {
  if (messages.length === 0) return "";
  const MAX_CHARS = 25_000;
  const lines: string[] = [`\n## Messages Slack récents (${messages.length})`];
  let used = 0;
  for (const m of messages) {
    const date = new Date(m.date).toLocaleDateString("fr-FR");
    const line = `- [SLACK #${m.channel} ${date}] ${m.author} : ${m.text.replace(/\s+/g, " ").slice(0, 600)}`;
    if (used + line.length > MAX_CHARS) {
      lines.push(`(${messages.length - (lines.length - 1)} message(s) plus ancien(s) omis)`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
