import { db } from "../db";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";

// DM Slack à l'owner d'un deal quand son client closed-won vient d'être enrichi.
// Déclenché en fin de runClientEnrichment (donc aussi bien sur le webhook
// closed-won que sur un enrichissement manuel d'un client importé). But : le
// commercial sait que la fiche est prête et va compléter les infos manquantes.
//
// Idempotence : on stamp owner_notified_at après un envoi réussi et on ne
// renvoie jamais si ce champ est déjà rempli (un re-enrich ne re-DM pas).
//
// Mode via env DÉDIÉ CLIENTS_OWNER_NOTIFY_MODE (indépendant de SLACK_MODE qui
// gère les debriefs sales-coach) :
//   - "test" (défaut) : DM à Arthur (CLAAP_NOTE_SLACK_TEST_USER), préfixé d'un
//     header montrant l'owner qui recevrait en prod ;
//   - "prod" : DM au vrai owner (lookup email -> display name -> fallback Arthur).
export async function notifyOwnerOfEnrichedClient(
  clientId: string,
): Promise<{ ok: boolean; sent?: boolean; reason?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: true, sent: false, reason: "slack_disabled" };
  }

  const { data: row, error } = await db
    .from("clients")
    .select("id, owner_email, owner_name, company_name, owner_notified_at")
    .eq("id", clientId)
    .single();

  if (error || !row) return { ok: false, reason: error?.message ?? "client_not_found" };
  if (row.owner_notified_at) return { ok: true, sent: false, reason: "already_notified" };

  const mode = process.env.CLIENTS_OWNER_NOTIFY_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const ficheUrl = `${appUrl}/clients/${clientId}`;

  const body = [
    `:tada: *${row.company_name} is now a client!*`,
    ``,
    `The full context for this account has just been enriched in SalesOS:`,
    `deal recap, coach brief, health score and all the key fields.`,
    ``,
    `Here is all the context, go check it out and add the missing information:`,
    `:point_right: <${ficheUrl}|Open the client fiche>`,
  ].join("\n");

  // Résolution du destinataire selon le mode.
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
      ? `:test_tube: *Test* — in prod, this DM would go to ${row.owner_email ?? row.owner_name ?? "the deal owner"}\n\n${body}`
      : body;

  try {
    await dmRecipient(memberId, text);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  await db
    .from("clients")
    .update({ owner_notified_at: new Date().toISOString() })
    .eq("id", clientId);

  return { ok: true, sent: true };
}
