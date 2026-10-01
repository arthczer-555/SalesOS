import { db } from "../db";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";

// DM Slack à l'AM et au CS assignés à un client closed-won, déclenché par l'AE
// depuis le panneau handover de la fiche. But : l'AM/CS savent que le contexte
// du deal est prêt (recap, brief, health, contacts, périmètre) et où le trouver.
//
// Contrairement à notify-owner, PAS de garde d'idempotence : l'AE peut re-notifier
// après avoir corrigé/complété des infos. On (re)stamp am_cs_notified_at à chaque
// envoi réussi et on persiste l'AM/CS choisis.
//
// Mode via la MÊME env que notify-owner (CLIENTS_OWNER_NOTIFY_MODE) :
//   - "prod" : DM aux vrais AM/CS (lookup email -> display name -> fallback Arthur), dédupé ;
//   - sinon "test" (défaut) : DM unique à Arthur, préfixé d'un header listant les vrais AM/CS.

type Assignee = { email: string; name?: string | null };

async function resolveMemberId(a: Assignee): Promise<string | null> {
  let memberId: string | null = null;
  if (a.email) memberId = await lookupSlackIdByEmail(a.email);
  if (!memberId && a.name) memberId = await findSlackIdByDisplayName(a.name);
  return memberId;
}

export async function notifyHandoverAmCs(
  clientId: string,
  assignees: { amEmail: string; amName?: string | null; csEmail: string; csName?: string | null },
): Promise<{ ok: boolean; sent?: boolean; mode?: "test" | "prod"; reason?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: true, sent: false, reason: "slack_disabled" };
  }

  const { data: row, error } = await db
    .from("clients")
    .select("id, company_name")
    .eq("id", clientId)
    .single();

  if (error || !row) return { ok: false, reason: error?.message ?? "client_not_found" };

  const mode = process.env.CLIENTS_OWNER_NOTIFY_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const ficheUrl = `${appUrl}/clients/${clientId}`;

  const body = [
    `:tada: *${row.company_name} is now a client — closed won!*`,
    ``,
    `You're part of the handover for this account (AM / CS). The full closed-won`,
    `context is ready in CoachelloHQ: deal recap, coach brief, health score, key`,
    `contacts and program scope.`,
    ``,
    `:point_right: <${ficheUrl}|Open the client fiche>`,
  ].join("\n");

  const am: Assignee = { email: assignees.amEmail, name: assignees.amName };
  const cs: Assignee = { email: assignees.csEmail, name: assignees.csName };

  try {
    if (mode === "prod") {
      // Résout chaque destinataire, dédupe par memberId (AM == CS possible).
      const sent = new Set<string>();
      for (const a of [am, cs]) {
        let memberId = await resolveMemberId(a);
        if (!memberId) {
          const arthur = await findArthurFallbackRecipient();
          memberId = arthur?.memberId ?? null;
        }
        if (!memberId || sent.has(memberId)) continue;
        await dmRecipient(memberId, body);
        sent.add(memberId);
      }
      if (sent.size === 0) return { ok: false, reason: "no_slack_recipient" };
    } else {
      const arthur = await findArthurFallbackRecipient();
      if (!arthur?.memberId) return { ok: false, reason: "no_slack_recipient" };
      const header = `:test_tube: *Test* — in prod, this DM would go to AM: ${am.name ?? am.email} · CS: ${cs.name ?? cs.email}`;
      await dmRecipient(arthur.memberId, `${header}\n\n${body}`);
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  await db
    .from("clients")
    .update({
      am_email: assignees.amEmail,
      am_name: assignees.amName ?? null,
      cs_email: assignees.csEmail,
      cs_name: assignees.csName ?? null,
      am_cs_notified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  return { ok: true, sent: true, mode };
}
