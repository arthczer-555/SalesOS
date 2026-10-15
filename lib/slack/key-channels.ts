/**
 * Canaux Slack clés de Coachello, connus du modèle sans avoir à les chercher :
 * ce registre est injecté dans les descriptions des outils Slack de
 * CoachelloAI (donc présent dans le prompt de chaque run d'agent) et dans la
 * description de la source Slack lue par le designer d'agents.
 *
 * L'ID permet de lire un canal privé sans passer par conversations.list (qui
 * ne liste un canal privé que si le bot en est membre). Le nom reste la clé
 * lisible : un canal renommé garde son ID.
 *
 * Isomorphe : aucun import serveur.
 */

export type KeySlackChannel = {
  name: string;
  id: string;
  /** Rôle du canal, en anglais (repris tel quel dans les descriptions). */
  purpose: string;
};

export const KEY_SLACK_CHANNELS: KeySlackChannel[] = [
  {
    name: "1a-new-incoming-leads",
    id: "C05S20AHV0D",
    purpose:
      "Inbound leads: website forms (Talk-to-expert), LinkedIn, referrals, posted by a bot or by the team. Each lead is then validated or rejected by the team in CoachelloHQ (Marketing > Leads).",
  },
  {
    name: "new-linkedin-ads-leads",
    id: "C096KTLTXL3",
    purpose: "HubSpot alerts for LinkedIn Ads lead forms (low volume).",
  },
  {
    name: "1y-new-meetings",
    id: "C05H8P0CK43",
    purpose:
      "Sales meetings booked, posted by each rep with the prospect and the acquisition channel (e.g. Outbound - Coldcall, Outbound - LinkedIn, incoming lead, event).",
  },
  {
    name: "2x-booking-notifications",
    id: "C021DAW907L",
    purpose:
      "Platform notifications for coaching sessions: new bookings, reschedules, orientation calls (client, company, coach, program, session). Coaches tagged (Internal) are internal coaches.",
  },
  {
    name: "1x-good-news",
    id: "C027PKZEL69",
    purpose: "Good news: deals signed, wins.",
  },
  {
    name: "10-sales-intelligence",
    id: "C06N5EM15B4",
    purpose: "Sales intelligence and market watch.",
  },
  {
    name: "11-everything-prospects",
    id: "C02URBLEMUY",
    purpose: "Everything about ongoing prospects and deals.",
  },
  {
    name: "12-everything-clients",
    id: "C02UE8W9JGH",
    purpose: "Everything about existing clients.",
  },
];

function byName(name: string): KeySlackChannel {
  const c = KEY_SLACK_CHANNELS.find((k) => k.name === name);
  if (!c) throw new Error(`Unknown key Slack channel: ${name}`);
  return c;
}

/** Canaux lus par des outils dédiés (get_inbound_leads, get_coaching_bookings). */
export const LEADS_CHANNEL = byName("1a-new-incoming-leads");
export const BOOKINGS_CHANNEL = byName("2x-booking-notifications");

export function keyChannelByName(name: string): KeySlackChannel | undefined {
  const target = name.replace(/^#/, "").trim().toLowerCase();
  return KEY_SLACK_CHANNELS.find((c) => c.name === target);
}

/** Bloc texte pour les descriptions d'outils : "#nom (ID) : rôle", un par ligne. */
export function keyChannelsCatalog(): string {
  return KEY_SLACK_CHANNELS.map((c) => `- #${c.name} (${c.id}) : ${c.purpose}`).join("\n");
}
