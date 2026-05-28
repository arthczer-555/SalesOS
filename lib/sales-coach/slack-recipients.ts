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
import {
  dmRecipient,
  findArthurFallbackRecipient,
  lookupSlackIdByEmail,
  type SlackRecipient,
} from "../slack/lookup";

// MeetingRecipient garde son nom historique (utilisé partout dans sales-coach),
// mais c'est structurellement un SlackRecipient { memberId, email }.
export type MeetingRecipient = SlackRecipient;

// Re-export des primitives partagées pour ne pas casser les imports existants.
export { dmRecipient, findArthurFallbackRecipient };

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

  // Claap ne liste pas systématiquement le recorder dans `meeting.participants`
  // (cas typique : meeting où l'enregistreur n'est pas sur l'invite calendar).
  // On l'injecte explicitement pour que l'alerte parte au recorder et pas
  // uniquement à Arthur en fallback. Dédupliqué via Set.
  const internalEmails = Array.from(
    new Set(
      [
        recorderEmail,
        ...(rec.meeting?.participants ?? []).map((p) => p.email?.toLowerCase().trim() ?? ""),
      ].filter((e) => !!e && e.includes("@") && e.split("@")[1] === recorderDomain),
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
    return ":test_tube: *Test* - fallback: no Coachello participant detected in this meeting, so in prod mode it would still go to Arthur.";
  }

  const emails = theoreticalRecipientEmails.join(", ");

  if (kind === "coaching") {
    return `:test_tube: *Test* - in prod mode, this message would be sent as a DM to: ${emails}`;
  }

  const channel = forwardChannelForAudience(audience);
  if (!channel) {
    return `:test_tube: *Test* - in prod mode, this message would be sent as a DM to: ${emails}`;
  }
  return `:test_tube: *Test* - in prod mode, this message would be sent as a DM to: ${emails} (who should then forward it in *${channel}*)`;
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
  return `:clipboard: *Tweak this message if needed and post it in ${channel}*`;
}

function forwardChannelForAudience(audience: Audience | null): string | null {
  if (audience === "client") return "#12-everything-clients";
  if (audience === "prospect") return "#11-everything-prospects";
  return null;
}
