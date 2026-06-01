/**
 * Primitives Slack génériques (lookup user + DM), partagées entre le pipeline
 * sales-coach (debriefs/recaps) et la notification owner côté clients. Extrait
 * de sales-coach/slack-recipients.ts pour éviter de dupliquer la plomberie HTTP.
 */

export type SlackRecipient = {
  memberId: string;
  email: string;
};

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

export async function lookupSlackIdByEmail(email: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } },
    );
    const data = await res.json();
    if (!data.ok) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Résout le nom d'affichage Slack d'un memberId via `users.info`. Renvoie
 * `display_name` (le handle choisi) ou `real_name` à défaut, `null` si rien ne
 * résout. Utilisé à l'onboarding pour remplir `slack_display_name` sans saisie
 * manuelle.
 */
export async function getSlackDisplayNameById(memberId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(memberId)}`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } },
    );
    const data = await res.json();
    if (!data.ok) return null;
    const profile = data.user?.profile ?? {};
    return profile.display_name?.trim() || profile.real_name?.trim() || null;
  } catch {
    return null;
  }
}

export async function findSlackIdByDisplayName(displayName: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.list?limit=200`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) return null;
  type Member = {
    id: string;
    deleted?: boolean;
    is_bot?: boolean;
    profile?: { real_name?: string; display_name?: string; email?: string };
  };
  const needle = displayName.toLowerCase().trim();
  const member = (data.members ?? []).find((m: Member) => {
    if (m.deleted || m.is_bot) return false;
    const realName = (m.profile?.real_name ?? "").toLowerCase();
    const dn = (m.profile?.display_name ?? "").toLowerCase();
    return realName.includes(needle) || dn.includes(needle);
  });
  return member?.id ?? null;
}

/**
 * Résout Arthur (ou la cible définie par `CLAAP_NOTE_SLACK_TEST_USER`) vers son
 * DM Slack. Sert de cible en mode test et de fallback pour ne jamais perdre un
 * message faute de destinataire résolu.
 */
export async function findArthurFallbackRecipient(): Promise<SlackRecipient | null> {
  const target = process.env.CLAAP_NOTE_SLACK_TEST_USER || "Arthur Czernichow";
  const memberId = await findSlackIdByDisplayName(target);
  if (!memberId) return null;
  return { memberId, email: target };
}

/**
 * Ouvre le DM channel pour un memberId et y poste le message. Retourne le ts
 * pour les permaliens si besoin.
 */
export async function dmRecipient(
  memberId: string,
  text: string,
): Promise<{ channelId: string; ts: string | null }> {
  const dm = await slackPost("/conversations.open", { users: memberId });
  const channelId = (dm as { channel: { id: string } }).channel.id;
  const posted = (await slackPost("/chat.postMessage", {
    channel: channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  })) as { ts?: string };
  return { channelId, ts: posted.ts ?? null };
}
