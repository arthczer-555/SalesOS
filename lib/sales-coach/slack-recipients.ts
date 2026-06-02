/**
 * Helpers partagés entre le recap meeting et le debrief coaching pour :
 *  - résoudre l'owner HubSpot du deal vers son DM Slack (destinataire
 *    principal) via `resolveDealOwnerRecipient` ;
 *  - identifier les autres internes Coachello (même domaine que le recorder)
 *    présents dans le meeting Claap, RECORDER EXCLU, et les résoudre vers
 *    leurs DM Slack ;
 *  - fallback sur Arthur (CLAAP_NOTE_SLACK_TEST_USER) si aucun destinataire
 *    n'a pu être identifié, pour qu'aucun message ne soit perdu ;
 *  - formater les 2 headers ajoutés aux messages :
 *      • un header "test mode" (mode dm) indiquant qui aurait reçu le DM
 *        en mode channels ;
 *      • un header "modifie et envoie" pour le recap, audience-aware
 *        (#11-everything-prospects vs #12-everything-clients).
 *
 * Routing : owner du deal + autres internes présents (recorder exclu, car
 * celui qui enregistre n'est pas toujours le responsable du deal). Si rien
 * ne résout : fallback Arthur (jamais d'envoi vide).
 */

import type { Audience } from "./meeting-recap";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
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
 * Le recorder est volontairement EXCLU : celui qui enregistre n'est pas
 * toujours le responsable du deal (souvent un collègue, un manager, un SE).
 * Le destinataire principal est l'owner du deal, ajouté séparément via
 * `resolveDealOwnerRecipient`. Si le recorder EST l'owner, il reçoit quand
 * même le DM par ce biais.
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

  // Autres internes présents (même domaine que le recorder), recorder exclu.
  // Le recorderDomain sert uniquement à distinguer interne / externe ; le
  // recorder lui-même n'est jamais notifié à ce titre.
  const internalEmails = Array.from(
    new Set(
      (rec.meeting?.participants ?? [])
        .map((p) => p.email?.toLowerCase().trim() ?? "")
        .filter(
          (e) =>
            !!e &&
            e.includes("@") &&
            e.split("@")[1] === recorderDomain &&
            e !== recorderEmail,
        ),
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
 * Résout l'owner HubSpot du deal vers son DM Slack. On le DM en plus des
 * participants internes du meeting, car l'AE responsable du deal n'est pas
 * toujours celui qui a enregistré le call (cas typique : un collègue lance le
 * Claap, ou l'AE était invité mais absent / sans email côté Claap).
 *
 * Résolution par email d'abord (fiable), puis fallback par nom d'affichage —
 * indispensable pour les analyses dont le `deal_snapshot` a été figé avant
 * l'ajout de `owner_email` (le snapshot ne porte alors que `owner_name`).
 */
export async function resolveDealOwnerRecipient(
  snapshot: { owner_email?: string | null; owner_name?: string | null } | null,
): Promise<MeetingRecipient | null> {
  if (!snapshot) return null;

  const email = snapshot.owner_email?.toLowerCase().trim();
  if (email) {
    const memberId = await lookupSlackIdByEmail(email);
    if (memberId) return { memberId, email };
  }

  const name = snapshot.owner_name?.trim();
  if (name) {
    const memberId = await findSlackIdByDisplayName(name);
    if (memberId) return { memberId, email: email || name };
  }

  return null;
}

/**
 * Déduplique une liste de destinataires par memberId (un même collègue peut
 * être à la fois recorder/participant ET owner du deal — on ne le DM qu'une
 * fois). Préserve l'ordre d'apparition.
 */
export function dedupeRecipients(recipients: MeetingRecipient[]): MeetingRecipient[] {
  const seen = new Set<string>();
  const out: MeetingRecipient[] = [];
  for (const r of recipients) {
    if (seen.has(r.memberId)) continue;
    seen.add(r.memberId);
    out.push(r);
  }
  return out;
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
