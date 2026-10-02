import { db } from "../db";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";
import { fetchHubspotDealFields } from "./hubspot-fields";
import { SECTION_DEFINITIONS, type ClientFields, type HubspotDealFields } from "./types";

// DM Slack à l'AM et au CS assignés à un client closed-won, déclenché par l'AE
// depuis le panneau handover de la fiche. But : l'AM/CS savent que le contexte
// du deal est prêt (recap, brief, health, contacts, périmètre) et où le trouver.
// Le DM résume directement les infos clés (prix, contrat, type de coaching,
// programme, kickoff, contact RH, langues, intégration).
//
// Contrairement à notify-owner, PAS de garde d'idempotence : l'AE peut re-notifier
// après avoir corrigé/complété des infos. On (re)stamp am_cs_notified_at à chaque
// envoi réussi et on persiste l'AM/CS choisis.
//
// Mode via la MÊME env que notify-owner (CLIENTS_OWNER_NOTIFY_MODE) :
//   - "prod" : DM aux vrais AM/CS (lookup email -> display name -> fallback Arthur), dédupé ;
//   - sinon "test" (défaut) : DM unique à Arthur, préfixé d'un header listant les vrais AM/CS.

type Assignee = { email: string; name?: string | null };

// Libellé d'affichage d'une valeur d'enum (ex: "humain" -> "Human"), repris de
// SECTION_DEFINITIONS pour rester aligné avec la fiche.
function optionLabel(section: keyof ClientFields, key: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const def = SECTION_DEFINITIONS.find((s) => s.key === section)?.fields.find((f) => f.key === key);
  return def?.optionLabels?.[value] ?? null;
}

// Fallback quand type_coaching est vide : le "Project Type" du deal HubSpot.
const PROJECT_TYPE_LABELS: Record<string, string> = {
  "Human Coaching Deal": "Human",
  "AI Coaching Deal": "AI",
};

// Slack interprète &, < et > dans le mrkdwn : à échapper dans les valeurs saisies.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

// Accepte une date ISO ("2026-11-01") ou un timestamp ms (format possible des
// propriétés date HubSpot). Valeur brute si illisible.
function fmtDate(raw: string): string {
  const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Joint les morceaux renseignés ; null si aucun (la ligne sera alors omise).
function joinParts(parts: Array<string | null | undefined>, sep = " · "): string | null {
  const clean = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return clean.length > 0 ? clean.join(sep) : null;
}

// Résumé des infos clés pour l'AM/CS. Toute ligne sans info est omise.
// HubSpot live best-effort : s'il échoue, on retombe sur le montant stocké au
// closed-won et les lignes qui n'existent que côté HubSpot disparaissent.
function buildKeyFacts(
  fields: Partial<ClientFields>,
  dealAmount: number | null,
  hs: HubspotDealFields | null,
): string[] {
  const scope = fields.program_scope;
  const general = fields.general_info;
  const planning = fields.planning;

  const hsAmount = hs?.amount != null ? Number(hs.amount) : null;
  const amount = hsAmount != null && Number.isFinite(hsAmount) ? hsAmount : dealAmount;
  const relationLabel = optionLabel("history", "relation_commerciale", fields.history?.relation_commerciale?.value);
  const price = amount != null ? `${fmtEur(amount)}${relationLabel ? ` (${relationLabel})` : ""}` : null;

  const coachingType =
    optionLabel("program_scope", "type_coaching", scope?.type_coaching?.value) ??
    (hs?.project_type ? PROJECT_TYPE_LABELS[hs.project_type] : null) ??
    null;

  const hr = general?.contact_principal_rh?.value;
  const kickoff = planning?.kickoff_envisage_le?.value;

  const facts: Array<[label: string, value: string | null]> = [
    ["Price", price],
    [
      "Contract",
      joinParts([
        hs?.duration_of_contract,
        hs?.contract_start_date ? `starts ${fmtDate(hs.contract_start_date)}` : null,
        hs?.number_of_credits ? `${Number(hs.number_of_credits).toLocaleString("en-GB")} credits` : null,
      ]),
    ],
    ["Coaching type", coachingType],
    [
      "Program",
      joinParts([
        scope?.nom_programme?.value,
        scope?.population_accompagnee?.value,
        scope?.nb_coaches_estime?.value != null ? `${scope.nb_coaches_estime.value} coachees` : null,
      ]),
    ],
    ["Kickoff", kickoff ? fmtDate(kickoff) : null],
    ["Main HR contact", hr?.name ? joinParts([hr.name, hr.role ? `(${hr.role})` : null], " ") : null],
    ["Languages", joinParts(general?.langues_requises?.value ?? [], ", ")],
    ["Integration", hs?.integration ?? null],
  ];

  return facts
    .filter((f): f is [string, string] => !!f[1])
    .map(([label, value]) => `*${label}:* ${esc(value)}`);
}

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
    .select("id, company_name, hubspot_deal_id, deal_amount, fields_json")
    .eq("id", clientId)
    .single();

  if (error || !row) return { ok: false, reason: error?.message ?? "client_not_found" };

  const mode = process.env.CLIENTS_OWNER_NOTIFY_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const ficheUrl = `${appUrl}/clients/${clientId}`;

  const hs = row.hubspot_deal_id ? await fetchHubspotDealFields(row.hubspot_deal_id) : null;
  const keyFacts = buildKeyFacts(
    (row.fields_json ?? {}) as Partial<ClientFields>,
    row.deal_amount as number | null,
    hs,
  );

  const body = [
    `:tada: *${esc(row.company_name)} is now a client, closed won!*`,
    ``,
    ...(keyFacts.length > 0
      ? [`You're part of the handover for this account (AM / CS). Key points:`, ``, ...keyFacts]
      : [`You're part of the handover for this account (AM / CS).`]),
    ``,
    `The full context (deal recap, coach brief, health score, all contacts) is in CoachelloHQ:`,
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
      const header = `:test_tube: *Test* - in prod, this DM would go to AM: ${am.name ?? am.email} · CS: ${cs.name ?? cs.email}`;
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
