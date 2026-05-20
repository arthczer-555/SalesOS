/**
 * Helpers partagés entre le recap meeting et le debrief coaching pour :
 *  - identifier les participants Coachello (même domaine que le recorder) du
 *    meeting Claap et les résoudre vers leurs DM Slack ;
 *  - fallback sur Arthur (CLAAP_NOTE_SLACK_TEST_USER) si aucun participant
 *    interne n'a pu être identifié, pour qu'aucun message ne soit perdu ;
 *  - formater les 2 headers ajoutés aux messages :
 *      • un header "test mode" (mode dm) indiquant qui aurait reçu le DM
 *        en mode channels ;
 *      • un header "modifie et envoie" pour le recap, audience-aware
 *        (#11-everything-prospects vs #12-everything-clients).
 *
 * Routing strict : on cible UNIQUEMENT les internes effectivement présents
 * dans le meeting. Pas de deal owner ajouté en backup. Si aucun interne :
 * fallback Arthur (jamais d'envoi vide). Cf. plan d'attaque.
 */

import type { Audience } from "./meeting-recap";

export type MeetingRecipient = {
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

async function lookupSlackIdByEmail(email: string): Promise<string | null> {
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

async function findSlackIdByDisplayName(displayName: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.list?limit=200`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) return null;
  type Member = { id: string; deleted?: boolean; is_bot?: boolean; profile?: { real_name?: string; display_name?: string; email?: string } };
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
 * Résout les participants Coachello internes du meeting Claap vers leurs IDs
 * Slack. "Interne" = email avec le même domaine que le recorder. Renvoie
 * l'email aussi, utilisé par le header test pour montrer qui aurait reçu le
 * DM en mode channels.
 *
 * Lazy-import de `getClaapRecording` pour éviter une dépendance circulaire
 * potentielle quand le helper est consommé par le pipeline.
 */
export async function resolveMeetingParticipantRecipients(
  claapRecordingId: string,
  recorderEmailFallback: string | null,
): Promise<MeetingRecipient[]> {
  if (!process.env.CLAAP_API_TOKEN) return [];

  const { getClaapRecording } = await import("../claap");
  const rec = await getClaapRecording(claapRecordingId).catch(() => null);
  if (!rec) return [];

  const recorderEmail = (rec.recorder?.email ?? recorderEmailFallback ?? "").toLowerCase();
  const recorderDomain = recorderEmail.split("@")[1];
  if (!recorderDomain) return [];

  const internalEmails = Array.from(
    new Set(
      (rec.meeting?.participants ?? [])
        .map((p) => p.email?.toLowerCase().trim())
        .filter((e): e is string => !!e && e.includes("@") && e.split("@")[1] === recorderDomain),
    ),
  );

  const recipients: MeetingRecipient[] = [];
  for (const email of internalEmails) {
    const memberId = await lookupSlackIdByEmail(email);
    if (memberId) recipients.push({ memberId, email });
  }
  return recipients;
}

/**
 * Résout Arthur (ou la cible définie par `CLAAP_NOTE_SLACK_TEST_USER`) vers
 * son DM Slack. Utilisé :
 *  - en mode `dm` pour toutes les envois (test) ;
 *  - en mode `channels` en fallback quand aucun participant interne n'est
 *    détecté dans le meeting.
 */
export async function findArthurFallbackRecipient(): Promise<MeetingRecipient | null> {
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

/**
 * Header affiché en haut des messages quand `SLACK_MODE=test`. Sert de control
 * de routing avant la bascule en prod : on visualise qui aurait reçu le DM si
 * on était en `prod`.
 *
 * Pour le recap, on ajoute aussi le channel cible que le commercial devrait
 * utiliser après reformatage (#11 prospect, #12 client). Pour le coaching,
 * pas de channel mentionné (le coaching ne se forwarde pas, c'est privé).
 *
 * Cas fallback (theoreticalRecipientEmails vide) : on signale qu'en mode prod,
 * on serait quand même tombé sur Arthur faute de participants.
 */
export function formatTestModeHeader(args: {
  theoreticalRecipientEmails: string[];
  audience: Audience | null;
  kind: "recap" | "coaching";
}): string {
  const { theoreticalRecipientEmails, audience, kind } = args;

  if (theoreticalRecipientEmails.length === 0) {
    return ":test_tube: *Test* — fallback : aucun participant Coachello détecté dans ce meeting, donc envoyé à Arthur en mode prod aussi.";
  }

  const emails = theoreticalRecipientEmails.join(", ");

  if (kind === "coaching") {
    return `:test_tube: *Test* — en mode prod, ce message serait envoyé en DM à : ${emails}`;
  }

  const channel = forwardChannelForAudience(audience);
  if (!channel) {
    return `:test_tube: *Test* — en mode prod, ce message serait envoyé en DM à : ${emails}`;
  }
  return `:test_tube: *Test* — en mode prod, ce message serait envoyé en DM à : ${emails} (qui devraient ensuite le forward dans *${channel}*)`;
}

/**
 * Header affiché DANS LES 2 MODES (test + prod), uniquement pour le recap.
 * Audience-aware : un seul channel mentionné, jamais les deux.
 *
 * Invariant : client → #12-everything-clients, prospect → #11-everything-prospects.
 * Ne JAMAIS inverser. Si audience est null (no deal), on retourne null et on
 * skip le header (le commercial verra le titre RECAP MEETING seul).
 */
export function formatForwardChannelHeader(audience: Audience | null): string | null {
  const channel = forwardChannelForAudience(audience);
  if (!channel) return null;
  return `:clipboard: *Modifie ce message et envoie-le dans ${channel}*`;
}

function forwardChannelForAudience(audience: Audience | null): string | null {
  if (audience === "client") return "#12-everything-clients";
  if (audience === "prospect") return "#11-everything-prospects";
  return null;
}
