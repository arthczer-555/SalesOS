import { db } from "../db";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";

// DM Slack quand un compte change d'AM ou de CS APRÈS le handover (ex : un CSM
// récupère le compte). Seule la personne qui arrive est notifiée : l'ancienne
// n'a pas besoin d'un message, et l'autre rôle n'a pas changé.
// Même mode que notify-handover / notify-owner (CLIENTS_OWNER_NOTIFY_MODE) :
// "prod" = DM au vrai destinataire, sinon DM de test à Arthur.

type Role = "AM" | "CS";

export async function notifyReassignment(
  clientId: string,
  change: { role: Role; email: string; name?: string | null },
): Promise<{ sent: boolean; mode: "test" | "prod"; reason?: string }> {
  const mode = process.env.CLIENTS_OWNER_NOTIFY_MODE === "prod" ? "prod" : "test";
  if (!process.env.SLACK_BOT_TOKEN) return { sent: false, mode, reason: "Slack is not configured" };

  const { data: row } = await db.from("clients").select("company_name").eq("id", clientId).single();
  const company = (row?.company_name as string | undefined) ?? "this account";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const roleLabel = change.role === "AM" ? "Account Manager" : "Customer Success";

  const body = [
    `:wave: *You're now the ${roleLabel} of ${company}.*`,
    ``,
    `Everything you need is on the account page: health, next actions, contacts, program scope and history.`,
    `:point_right: <${appUrl}/clients/${clientId}|Open the account page>`,
  ].join("\n");

  try {
    if (mode === "prod") {
      let memberId = await lookupSlackIdByEmail(change.email);
      if (!memberId && change.name) memberId = await findSlackIdByDisplayName(change.name);
      if (!memberId) memberId = (await findArthurFallbackRecipient())?.memberId ?? null;
      if (!memberId) return { sent: false, mode, reason: "No Slack account found for this person" };
      await dmRecipient(memberId, body);
    } else {
      const arthur = await findArthurFallbackRecipient();
      if (!arthur?.memberId) return { sent: false, mode, reason: "No Slack test recipient" };
      await dmRecipient(arthur.memberId, `:test_tube: *Test* - in prod, this DM would go to ${change.name ?? change.email} (${change.role})\n\n${body}`);
    }
    return { sent: true, mode };
  } catch (e) {
    return { sent: false, mode, reason: e instanceof Error ? e.message : String(e) };
  }
}
