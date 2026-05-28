/**
 * Wrapper minimal autour de l'API Slack pour CoachelloGPT dans Slack.
 * On garde ce module fin et générique. Les helpers métier (briefings,
 * sales-coach…) gardent leurs propres wrappers dans leurs dossiers respectifs.
 */

const BASE = "https://slack.com/api";

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN manquant");
  return t;
}

async function call<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error ?? "unknown_error"}`);
  return data;
}

export type SlackBlock = Record<string, unknown>;

export async function postMessage(args: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}): Promise<{ ok: true; ts: string; channel: string }> {
  return call<{ ok: true; ts: string; channel: string }>("/chat.postMessage", {
    ...args,
    unfurl_links: false,
    unfurl_media: false,
  });
}

export async function updateMessage(args: {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<{ ok: true }> {
  return call<{ ok: true }>("/chat.update", args);
}

export async function publishHomeView(args: {
  user_id: string;
  view: { type: "home"; blocks: SlackBlock[] };
}): Promise<{ ok: true }> {
  return call<{ ok: true }>("/views.publish", args);
}

export async function getRecentMessages(
  channel: string,
  limit = 15,
): Promise<{ text?: string; bot_id?: string; subtype?: string; ts: string }[]> {
  const res = await fetch(
    `${BASE}/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token()}` } },
  );
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    messages?: { text?: string; bot_id?: string; subtype?: string; ts: string }[];
  };
  if (!data.ok) throw new Error(`Slack /conversations.history → ${data.error ?? "unknown_error"}`);
  return data.messages ?? [];
}

export async function getUserInfo(userId: string): Promise<{
  id: string;
  name: string;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string };
}> {
  const res = await fetch(
    `${BASE}/users.info?user=${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${token()}` } },
  );
  const data = (await res.json()) as { ok: boolean; user?: unknown; error?: string };
  if (!data.ok) throw new Error(`Slack /users.info → ${data.error ?? "unknown_error"}`);
  return data.user as {
    id: string;
    name: string;
    real_name?: string;
    profile?: { email?: string; real_name?: string; display_name?: string };
  };
}
