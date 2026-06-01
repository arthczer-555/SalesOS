import { db } from "../db";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";

// DM Slack à l'owner d'un deal quand un nouveau client vient d'être importé
// (webhook closed-won ou backfill manuel) : on a découvert les meetings Claap
// du compte mais l'analyse ne démarrera qu'une fois qu'il aura confirmé la
// liste (et ajouté ceux qu'on aurait ratés). But : le commercial valide la
// matière avant qu'on lance l'enrichissement IA.
//
// Calqué sur notifyOwnerOfEnrichedClient (même plomberie de résolution
// destinataire + mode test/prod via CLIENTS_OWNER_NOTIFY_MODE). Idempotence :
// on stamp meeting_confirmation_requested_at après un envoi réussi et on ne
// renvoie jamais si ce champ est déjà rempli.
export async function notifyOwnerToConfirmMeetings(
  clientId: string,
): Promise<{ ok: boolean; sent?: boolean; reason?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: true, sent: false, reason: "slack_disabled" };
  }

  const { data: row, error } = await db
    .from("clients")
    .select(
      "id, owner_email, owner_name, company_name, pending_meeting_candidates, meeting_confirmation_requested_at",
    )
    .eq("id", clientId)
    .single();

  if (error || !row) return { ok: false, reason: error?.message ?? "client_not_found" };
  if (row.meeting_confirmation_requested_at) return { ok: true, sent: false, reason: "already_notified" };

  const mode = process.env.CLIENTS_OWNER_NOTIFY_MODE === "prod" ? "prod" : "test";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  // ?confirm=meetings : ouvre directement le popup de confirmation à l'arrivée
  // sur la fiche (cf. ClientDetailPage), sinon l'AE atterrit sur la fiche sans
  // savoir où cliquer.
  const ficheUrl = `${appUrl}/clients/${clientId}?confirm=meetings`;
  const nbMeetings = Array.isArray(row.pending_meeting_candidates)
    ? row.pending_meeting_candidates.length
    : 0;
  const meetingsLine =
    nbMeetings > 0
      ? `We found ${nbMeetings} Claap meeting${nbMeetings > 1 ? "s" : ""} linked to this account.`
      : `We could not find any Claap meeting automatically, please add the ones that took place.`;

  const body = [
    `:mag: *${row.company_name} - confirm the meetings before we analyze the account*`,
    ``,
    `We're about to build the full SalesOS context for ${row.company_name}. ${meetingsLine}`,
    `Please confirm they are all there (and add any we missed), then the analysis will start automatically.`,
    ``,
    `:point_right: <${ficheUrl}|Review and confirm the meetings>`,
  ].join("\n");

  // Résolution du destinataire selon le mode (identique à notify-owner).
  let memberId: string | null = null;
  if (mode === "prod") {
    if (row.owner_email) memberId = await lookupSlackIdByEmail(row.owner_email);
    if (!memberId && row.owner_name) memberId = await findSlackIdByDisplayName(row.owner_name);
    if (!memberId) {
      const arthur = await findArthurFallbackRecipient();
      memberId = arthur?.memberId ?? null;
    }
  } else {
    const arthur = await findArthurFallbackRecipient();
    memberId = arthur?.memberId ?? null;
  }

  if (!memberId) return { ok: false, reason: "no_slack_recipient" };

  const text =
    mode === "test"
      ? `:test_tube: *Test* - in prod, this DM would go to ${row.owner_email ?? row.owner_name ?? "the deal owner"}\n\n${body}`
      : body;

  try {
    await dmRecipient(memberId, text);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  await db
    .from("clients")
    .update({ meeting_confirmation_requested_at: new Date().toISOString() })
    .eq("id", clientId);

  return { ok: true, sent: true };
}
