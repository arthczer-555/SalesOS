// DM Slack privé à chaque idée déposée depuis la boîte à idées du dashboard.
//
// Une idée non lue est une idée perdue : /admin/ideas suppose qu'on pense à
// aller voir. Le DM inverse la charge — la notification vient à nous.
//
// Destinataire unique et volontairement non paramétrable par utilisateur :
// `IDEAS_NOTIFY_SLACK_USER` (display name ou real name Slack), sinon le
// destinataire de repli commun (`CLAAP_NOTE_SLACK_TEST_USER`, Arthur).
//
// Best-effort : l'idée est déjà en base quand on arrive ici. Un Slack qui
// tombe ne doit jamais transformer un dépôt réussi en erreur côté utilisateur.

import { dmRecipient, findArthurFallbackRecipient, findSlackIdByDisplayName } from "../slack/lookup";
import { IDEA_MAX_LENGTH } from "./types";

/** Au-delà, le DM devient un mur de texte : on tronque et on renvoie vers l'app. */
const PREVIEW_MAX = 700;

export async function notifyNewIdea(args: {
  content: string;
  authorName: string | null;
  authorEmail: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) return { sent: false, reason: "slack_disabled" };

  const target = process.env.IDEAS_NOTIFY_SLACK_USER?.trim();
  const memberId = target
    ? await findSlackIdByDisplayName(target)
    : ((await findArthurFallbackRecipient())?.memberId ?? null);

  if (!memberId) return { sent: false, reason: "no_slack_recipient" };

  const author = args.authorName?.trim() || args.authorEmail?.trim() || "Someone";
  const emailSuffix =
    args.authorName?.trim() && args.authorEmail?.trim() ? ` (${args.authorEmail.trim()})` : "";

  // Le texte de l'idée est cité pour rester lisible même sur plusieurs lignes.
  const truncated = args.content.length > PREVIEW_MAX;
  const preview = truncated ? `${args.content.slice(0, PREVIEW_MAX)}…` : args.content;
  const quoted = preview
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const lines = [
    `:bulb: *New idea from ${author}${emailSuffix}*`,
    ``,
    quoted,
  ];
  if (truncated) lines.push(``, `_Truncated — up to ${IDEA_MAX_LENGTH} characters in the app._`);
  if (appUrl) lines.push(``, `<${appUrl}/admin/ideas|Read all ideas →>`);

  try {
    await dmRecipient(memberId, lines.join("\n"));
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { sent: true };
}
