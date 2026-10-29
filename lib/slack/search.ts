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

// Canaux de flux automatiques (réservations, alertes, nouveaux leads…) : bruit
// pour un contexte IA. Convention du workspace : préfixe "<chiffre><lettre>-"
// (0x-development-updates, 1y-new-meetings, 2x-booking-notifications…).
const NOISY_CHANNEL = /^\d[a-z]-|(^|-)(notifications?|bookings?|alerts?|logs?)($|-)/i;

export function isNoisySlackChannel(name: string): boolean {
  return NOISY_CHANNEL.test(name);
}
