// Lecture de messages Slack pour enrichir un contexte IA (analyse de deal,
// refresh des fiches clients). Deux tokens :
//  - SLACK_USER_TOKEN : seul à pouvoir appeler search.messages (recherche sur
//    tous les canaux visibles par l'utilisateur qui a installé l'app) ;
//  - SLACK_BOT_TOKEN : conversations.list / history / replies, limité aux
//    canaux dont le bot est membre.
// Lecture seule, best-effort : les erreurs remontent dans `error` pour que
// l'appelant puisse les afficher plutôt que de les confondre avec "0 message".

export type SlackMessage = {
  channel: string; // nom du canal (sans #)
  text: string;
  user: string; // user id Slack (ou username pour les bots)
  timestamp: string; // ts Slack ("1727512345.000100")
};

export async function slackBotGet<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, string>,
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  if (!process.env.SLACK_BOT_TOKEN) return { ok: false, error: "slack_bot_token_missing" };
  const url = new URL(`https://slack.com/api${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const data = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return data as { ok: true } & T;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Recherche plein texte (search.messages) via le user token. `after` (YYYY-MM-DD)
 * filtre côté Slack. Renvoie { messages: [], error } si le token manque ou si
 * l'API refuse, pour que l'appelant distingue "rien trouvé" de "pas pu chercher".
 */
export async function searchSlackMessages(
  query: string,
  opts: { after?: string | null; count?: number } = {},
): Promise<{ messages: SlackMessage[]; error: string | null }> {
  const userToken = process.env.SLACK_USER_TOKEN;
  if (!userToken) return { messages: [], error: "slack_user_token_missing" };
  const q = opts.after ? `${query} after:${opts.after}` : query;
  const url = new URL("https://slack.com/api/search.messages");
  url.searchParams.set("query", q);
  url.searchParams.set("count", String(opts.count ?? 20));
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("sort_dir", "desc");
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${userToken}` } });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      messages?: {
        matches?: Array<{ channel?: { name?: string }; text?: string; user?: string; username?: string; ts?: string }>;
      };
    };
    if (!data.ok) return { messages: [], error: data.error ?? `HTTP ${res.status}` };
    const messages = (data.messages?.matches ?? []).map((m) => ({
      channel: m.channel?.name ?? "",
      text: m.text ?? "",
      user: m.user ?? m.username ?? "",
      timestamp: m.ts ?? "",
    }));
    return { messages, error: null };
  } catch (e) {
    return { messages: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Messages qui mentionnent une entreprise (analyse de deal). search.messages si
 * le user token est dispo, sinon scan des canaux du bot (historique récent,
 * filtre mot-clé). Best-effort : [] en cas d'échec.
 */
export async function searchSlackForCompany(companyName: string): Promise<SlackMessage[]> {
  if (!companyName || !process.env.SLACK_BOT_TOKEN) return [];

  const searched = await searchSlackMessages(companyName, { count: 20 });
  if (!searched.error) {
    return searched.messages.slice(0, 20).map((m) => ({ ...m, text: m.text.slice(0, 500) }));
  }

  const messages: SlackMessage[] = [];
  const channels: { name: string; id: string }[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "200", types: "public_channel,private_channel" };
    if (cursor) params.cursor = cursor;
    const data = await slackBotGet<{ channels?: { name: string; id: string }[]; response_metadata?: { next_cursor?: string } }>(
      "/conversations.list",
      params,
    );
    if (!data.ok) break;
    channels.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const keyword = companyName.toLowerCase();
  for (const ch of channels) {
    if (messages.length >= 20) break;
    const history = await slackBotGet<{ messages?: Array<{ text?: string; user?: string; ts?: string }> }>(
      "/conversations.history",
      { channel: ch.id, limit: "200" },
    );
    if (!history.ok) continue;
    const matched = (history.messages ?? []).filter((m) => m.text?.toLowerCase().includes(keyword));
    for (const m of matched.slice(0, 5)) {
      messages.push({ channel: ch.name, text: m.text?.slice(0, 500) ?? "", user: m.user ?? "", timestamp: m.ts ?? "" });
    }
  }
  return messages;
}
