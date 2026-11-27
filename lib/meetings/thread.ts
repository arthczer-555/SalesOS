// Couche IA du fil d'une annonce : comprend ce que le commercial écrit en
// langage libre ("her email is x", "the meeting is with Leon", "it's an RFP",
// "moved to 12/12") et le traduit en corrections, validation ou refus.
// Les valeurs sont revérifiées en code avant d'entrer dans la proposition.

import { isOfferType, isSaleType, type OfferType, type SaleType } from "@/lib/leads/origin";
import { stripEmDashes } from "@/lib/no-em-dash";
import { cleanDate, cleanEmail, cleanTime, postedOnParis } from "./extract";
import { callStructured } from "./llm";
import { memberBySlackId, type TeamMember } from "./roster";
import { SOURCE_KEYS, type Overrides, type Proposal, type SourceKey, type ThreadLogEntry } from "./types";
import { formatMeetingDate } from "./proposal";
import { dealOriginLabel } from "@/lib/leads/origin";

export type ThreadIntent = "update" | "confirm" | "cancel" | "note" | "question" | "none";

export interface ThreadDecision {
  intent: ThreadIntent;
  overrides: Overrides;
  reply: string;
  /** Changement de date après création (pour le Sales Coach). */
  meetingDate: string | null;
  meetingTime: string | null;
}

const SYSTEM = `You help a Coachello sales rep fix the card proposal for a meeting they announced in Slack. The bot showed what it understood; the rep answers in the thread, in French or English, in their own words.

Turn the rep's new message into an intent and field updates:
- intent "update": the message corrects or adds information. Fill ONLY the fields it changes, leave the others empty.
- intent "confirm": the rep agrees the card can be created ("yes", "go", "c'est bon", "create it"), possibly together with an update.
- intent "cancel": the rep says not to create anything ("no", "skip", "not needed").
- intent "note": useful information that changes no field (context about the prospect, the project).
- intent "question": the rep asks the bot something. Answer it in "reply".
- intent "none": nothing to do (thanks, emoji, chit-chat).

Fields:
- contact_email, contact_name, contact_title: the main external contact. Never a Coachello colleague.
- extra_contact_name, extra_contact_email: one more external attendee, if added.
- company_name: the external company.
- owner_slack_id: the Coachello colleague who owns the card, when the rep says so ("the meeting is with Leon", "c'est pour Mehdi"). Use the Slack id from the team list.
- meeting_date (YYYY-MM-DD) and meeting_time (HH:MM, 24h): resolved against the message date. French dates are day/month.
- source_key: outbound, inbound, referral, network, events, partner_coprospecting, partner_inbound, existing_customer.
- referring_partner: the partner's name.
- offer_types: "ai-roleplay" and/or "human-coaching", only when stated.
- sale_type: "rfp" when it is a tender / RFP / appel d'offres, "direct" when the rep says it is not.
- card_action: "link" (attach the meeting to the existing open card), "new_card" (create a separate card anyway), "create_card_anyway" (create a card although the bot thought it was a partner or non-sales meeting).
- reply: one short English sentence for the thread: what you understood, or the answer to the question. Empty for "none".

When the card already exists (after creation), only meeting_date / meeting_time changes and notes are possible.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["update", "confirm", "cancel", "note", "question", "none"] },
    contact_email: { type: "string" },
    contact_name: { type: "string" },
    contact_title: { type: "string" },
    extra_contact_name: { type: "string" },
    extra_contact_email: { type: "string" },
    company_name: { type: "string" },
    owner_slack_id: { type: "string" },
    meeting_date: { type: "string" },
    meeting_time: { type: "string" },
    source_key: { type: "string", enum: ["", ...SOURCE_KEYS.filter((k) => k !== "unknown")] },
    referring_partner: { type: "string" },
    offer_types: { type: "array", items: { type: "string", enum: ["ai-roleplay", "human-coaching"] } },
    sale_type: { type: "string", enum: ["", "direct", "rfp"] },
    card_action: { type: "string", enum: ["", "link", "new_card", "create_card_anyway"] },
    reply: { type: "string" },
  },
  required: [
    "intent",
    "contact_email",
    "contact_name",
    "contact_title",
    "extra_contact_name",
    "extra_contact_email",
    "company_name",
    "owner_slack_id",
    "meeting_date",
    "meeting_time",
    "source_key",
    "referring_partner",
    "offer_types",
    "sale_type",
    "card_action",
    "reply",
  ],
} as const;

type RawDecision = Record<string, unknown> & { intent?: string; offer_types?: unknown };

const str = (v: unknown) => stripEmDashes(typeof v === "string" ? v.trim() : "");

function summarize(p: Proposal | null): string {
  if (!p) return "(no proposal yet)";
  const c = p.contacts[0];
  return [
    `contact: ${c?.name ?? "?"}${c?.title ? `, ${c.title}` : ""} · email: ${c?.email ?? "missing"}`,
    p.contacts.length > 1 ? `other attendees: ${p.contacts.slice(1).map((x) => x.name ?? x.email).join(", ")}` : null,
    `company: ${p.company.name ?? "missing"}`,
    `meeting: ${formatMeetingDate(p.meetingDate, p.meetingTime) ?? "no date"}`,
    `owner: ${p.owner?.name ?? "missing"}`,
    `source: ${p.origin ? dealOriginLabel(p.origin) : "missing"} · offer: ${p.offerTypes.join(", ") || "none"} · sale type: ${p.saleType}`,
    `action: ${p.action}${p.existingCard ? ` (open card: ${p.existingCard.name})` : ""}`,
    p.missing.length ? `missing: ${p.missing.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function interpretThreadMessage(input: {
  text: string;
  messageTs: string;
  authorName: string;
  announcementText: string;
  proposal: Proposal | null;
  history: ThreadLogEntry[];
  roster: TeamMember[];
  afterCreation: boolean;
}): Promise<ThreadDecision> {
  const team = input.roster
    .filter((m) => m.slackUserId)
    .map((m) => `${m.name} (Slack id ${m.slackUserId})`)
    .join("; ");
  const history = input.history
    .slice(-8)
    .map((h) => `- ${h.user ?? "?"}: ${h.text}`)
    .join("\n");
  const prompt = [
    `Message date: ${postedOnParis(input.messageTs)} (Paris time)`,
    `Coachello team: ${team}`,
    `Original announcement: """${input.announcementText}"""`,
    `Current proposal:\n${summarize(input.proposal)}`,
    input.afterCreation ? "The card is ALREADY created: only a new meeting date/time or a note is possible." : null,
    history ? `Earlier messages in the thread:\n${history}` : null,
    `New message from ${input.authorName}: """${input.text}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callStructured<RawDecision>({ system: SYSTEM, content: [{ type: "text", text: prompt }], schema: SCHEMA as unknown as Record<string, unknown>, label: "thread", maxTokens: 1500 });
  return sanitizeDecision(raw, input.roster, input.afterCreation);
}

export function sanitizeDecision(raw: RawDecision, roster: TeamMember[], afterCreation: boolean): ThreadDecision {
  const intents: ThreadIntent[] = ["update", "confirm", "cancel", "note", "question", "none"];
  const intent = intents.includes(raw.intent as ThreadIntent) ? (raw.intent as ThreadIntent) : "none";
  const o: Overrides = {};
  const meetingDate = cleanDate(raw.meeting_date) || null;
  const meetingTime = cleanTime(raw.meeting_time) || null;
  if (!afterCreation) {
    const email = cleanEmail(raw.contact_email);
    if (email) o.contactEmail = email;
    if (str(raw.contact_name)) o.contactName = str(raw.contact_name);
    if (str(raw.contact_title)) o.contactTitle = str(raw.contact_title);
    const extraEmail = cleanEmail(raw.extra_contact_email);
    if (extraEmail) o.extraContacts = [{ name: str(raw.extra_contact_name) || null, email: extraEmail }];
    if (str(raw.company_name)) o.companyName = str(raw.company_name);
    const owner = memberBySlackId(roster, str(raw.owner_slack_id));
    if (owner) o.ownerSlackId = owner.slackUserId as string;
    if (meetingDate) o.meetingDate = meetingDate;
    if (meetingTime) o.meetingTime = meetingTime;
    const sk = str(raw.source_key);
    if ((SOURCE_KEYS as readonly string[]).includes(sk) && sk !== "unknown") o.sourceKey = sk as SourceKey;
    if (str(raw.referring_partner)) o.referringPartner = str(raw.referring_partner);
    const offers = (Array.isArray(raw.offer_types) ? raw.offer_types : []).filter(isOfferType) as OfferType[];
    if (offers.length) o.offerTypes = [...new Set(offers)];
    if (isSaleType(raw.sale_type)) o.saleType = raw.sale_type as SaleType;
    const action = str(raw.card_action);
    if (action === "link" || action === "new_card") o.cardAction = action;
    if (action === "create_card_anyway") o.createCardAnyway = true;
  }
  return { intent, overrides: o, reply: str(raw.reply), meetingDate, meetingTime };
}

/** Fusion des corrections : les nouvelles priment, les contacts ajoutés s'accumulent. */
export function mergeOverrides(base: Overrides, next: Overrides): Overrides {
  const extra = [...(base.extraContacts ?? [])];
  for (const c of next.extraContacts ?? []) if (!extra.some((e) => e.email === c.email)) extra.push(c);
  return { ...base, ...next, ...(extra.length ? { extraContacts: extra } : {}) };
}
