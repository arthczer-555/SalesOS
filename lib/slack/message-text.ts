// Texte lisible d'un message Slack brut (conversations.history).
//
// Les bots d'intégration (HubSpot, plateforme Coachello, formulaires)
// mettent souvent leur contenu dans `attachments` ou `blocks`, avec un `text`
// vide ou réduit à une notification : lire seulement `text` fait disparaître
// ces messages. On assemble donc text + attachments + blocks, sans doublon.

export type RawSlackMessage = {
  ts?: string;
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string };
  thread_ts?: string;
  text?: string;
  attachments?: Array<{
    /** Présents sur un aperçu de lien (unfurl) : pas du contenu du message. */
    from_url?: string;
    original_url?: string;
    pretext?: string;
    title?: string;
    text?: string;
    fallback?: string;
    fields?: Array<{ title?: string; value?: string }>;
  }>;
  blocks?: SlackBlock[];
};

type SlackBlock = {
  type?: string;
  text?: { text?: string };
  fields?: Array<{ text?: string }>;
  elements?: SlackElement[];
};

type SlackElement = {
  type?: string;
  text?: string | { text?: string };
  elements?: SlackElement[];
};

// Événements système qui ne sont pas des messages (arrivées, départs,
// renommages, épinglages…). bot_message et thread_broadcast restent.
const SYSTEM_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "group_topic",
  "group_purpose",
  "group_name",
  "pinned_item",
  "unpinned_item",
  "tombstone",
  "message_deleted",
]);

export function isSystemMessage(m: RawSlackMessage): boolean {
  return !!m.subtype && SYSTEM_SUBTYPES.has(m.subtype);
}

/** Message top-level (pas une réponse de thread). */
export function isTopLevel(m: RawSlackMessage): boolean {
  return !m.thread_ts || m.thread_ts === m.ts;
}

function elementText(el: SlackElement): string {
  const own = typeof el.text === "string" ? el.text : el.text?.text ?? "";
  const nested = (el.elements ?? []).map(elementText).join("");
  return own + nested;
}

function blocksText(blocks: SlackBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.text?.text) out.push(b.text.text);
    for (const f of b.fields ?? []) if (f.text) out.push(f.text);
    if (b.type === "rich_text" || b.type === "context") {
      const t = (b.elements ?? []).map(elementText).join(b.type === "context" ? " " : "\n").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Entités que Slack échappe dans le texte des messages (&, <, >). */
export function decodeSlackEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Forme comparable : liens <url|libellé> réduits au libellé, sans marqueurs
// mrkdwn ni espaces multiples. Un bloc qui répète `text` ne compte pas double.
const comparable = (s: string) =>
  s
    .replace(/<[^|>]+\|([^>]+)>/g, "$1")
    .replace(/:[a-z0-9_+-]+:/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Texte complet du message : text, puis attachments et blocks s'ils apportent du contenu. */
export function messageText(m: RawSlackMessage): string {
  const parts: string[] = [];
  const push = (s: string | undefined) => {
    const t = (s ?? "").trim();
    if (!t) return;
    const c = comparable(t);
    if (parts.some((p) => comparable(p).includes(c))) return;
    parts.push(t);
  };
  push(m.text);
  // Pour un humain, Slack remplit toujours `text` à partir du rich_text : il
  // fait foi. Les attachments / blocks ne servent que pour les bots (ou un
  // `text` vide).
  const isBot = !!m.bot_id || m.subtype === "bot_message";
  if (!isBot && parts.length > 0) return decodeSlackEntities(parts.join("\n"));
  for (const a of m.attachments ?? []) {
    if (a.from_url || a.original_url) continue;
    push(a.pretext);
    push(a.title);
    push(a.text);
    for (const f of a.fields ?? []) push([f.title, f.value].filter(Boolean).join(": "));
    if (!a.text && !(a.fields ?? []).length) push(a.fallback);
  }
  for (const t of blocksText(m.blocks ?? [])) push(t);
  return decodeSlackEntities(parts.join("\n"));
}

/** Nom affichable d'un bot (les humains se résolvent via users.info). */
export function botName(m: RawSlackMessage): string | null {
  if (!m.bot_id && m.subtype !== "bot_message") return null;
  return m.username || m.bot_profile?.name || "bot";
}
