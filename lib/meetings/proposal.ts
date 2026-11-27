// Textes Slack du flux #1y-new-meetings (en anglais : c'est le produit).
// La proposition est un seul message du bot, mis à jour à chaque correction,
// puis remplacé par l'issue (carte créée, reliée, refus, expiration).

import { hubspotDealUrl } from "@/lib/hubspot/urls";
import { OFFER_TYPES, dealOriginLabel, type OfferType } from "@/lib/leads/origin";
import { stripEmDashes } from "@/lib/no-em-dash";
import { MEETINGS_CHANNEL_NAME } from "./config";
import type { AnnouncementRow, FieldSource, MissingField, Proposal } from "./types";

const MISSING_LABELS: Record<MissingField, string> = {
  email: "the contact's email (the Sales Coach needs it to attach the recording)",
  owner: "the owner (a Coachello user with a HubSpot owner)",
  source: "the Source (inbound, outbound, referral, network, event, partner...)",
  partner: "the referring partner",
  company: "the company",
};

const SOURCE_LABELS: Record<FieldSource, string> = {
  post: "from the post",
  thread: "given in the thread",
  lead: "from the inbound lead",
  hubspot: "HubSpot contact",
  default: "default",
};

export function formatMeetingDate(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return time ? `${day}, ${time}` : day;
}

const offerLabels = (offers: readonly OfferType[]) => offers.map((o) => OFFER_TYPES.find((t) => t.value === o)?.label ?? o).join(", ");
const link = (url: string | null, label: string) => (url ? `<${url}|${label}>` : label);

function header(row: AnnouncementRow, p: Proposal, posterName: string | null): string[] {
  const lines: string[] = [];
  if (row.mode === "test") {
    lines.push(
      row.source_kind === "mirror"
        ? `:test_tube: *Test* · copy of a post by ${posterName ?? "someone"} in #${MEETINGS_CHANNEL_NAME} (${link(row.slack_permalink, "original")}). In live mode this reply goes in its thread. A ✅ here creates a TEST card on the test contact, never on the real prospect.`
        : ":test_tube: *Test* · a ✅ here creates a TEST card on the test contact, never on the real prospect.",
    );
  }
  if (p.action === "link" && p.existingCard) lines.push(`:calendar: *New meeting: link it to the open card ${link(hubspotDealUrl(p.existingCard.id), p.existingCard.name)}?*`);
  else if (p.action === "none") lines.push(p.kind === "partner" ? ":handshake: *Partner meeting?*" : ":speech_balloon: *Meeting noted*");
  else lines.push(":calendar: *New meeting: create the card in Prospection › R1 scheduled?*");
  return lines;
}

/** Message de proposition (mis à jour à chaque correction du fil). */
export function renderProposal(row: AnnouncementRow, p: Proposal, posterName: string | null): string {
  const lines = header(row, p, posterName);
  p.contacts.forEach((c, i) => {
    const who = [c.name, c.title].filter(Boolean).join(", ") || (i === 0 ? "not found" : "?");
    const email = c.email ? `${c.email}${c.emailSource ? ` (${SOURCE_LABELS[c.emailSource]})` : ""}` : i === 0 ? ":warning: *email missing*" : null;
    lines.push(`*${i === 0 ? "Contact" : "Also"}:* ${who}${email ? ` · ${email}` : ""}`);
  });
  if (p.company.name) lines.push(`*Company:* ${p.company.name} (${p.company.hubspotCompanyId ? (p.company.hubspotName ? `HubSpot company: ${p.company.hubspotName}` : "HubSpot company") : "new company"})`);
  else lines.push("*Company:* :warning: not found");
  lines.push(`*Meeting:* ${formatMeetingDate(p.meetingDate, p.meetingTime) ?? ":warning: date not found"}`);
  if (p.owner) lines.push(`*Owner:* ${p.owner.name}${p.owner.source === "runner" ? " (runs the meeting)" : ""}${row.mode === "test" ? " · the TEST card is assigned to you" : ""}`);
  else lines.push("*Owner:* :warning: not found");
  const source = p.origin ? `${dealOriginLabel(p.origin)}${p.sourceDetail ? ` (${p.sourceDetail})` : ""}` : ":warning: missing";
  lines.push(`*Source:* ${source} · *Offer:* ${p.offerTypes.length ? offerLabels(p.offerTypes) : "not specified"} · *Sale type:* ${p.saleType === "rfp" ? "RFP (tender)" : "Direct"}`);
  if (p.referringPartner) lines.push(`*Referring partner:* ${p.referringPartner}`);
  if (p.lead) {
    const on = p.lead.validatedAt ? new Date(p.lead.validatedAt).toLocaleDateString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short" }) : null;
    lines.push(`*From the inbound lead* ${link(p.lead.permalink, "validated")}${on ? ` on ${on}` : ""}: Source and offer taken from it.`);
  }
  if (p.existingCard && p.action !== "link") lines.push(`*Open card:* ${link(hubspotDealUrl(p.existingCard.id), p.existingCard.name)}${p.existingCard.stageLabel ? ` (${p.existingCard.stageLabel})` : ""}: a separate card will be created.`);
  if (p.existingCard && p.action === "link") lines.push(`*Open card:* ${p.existingCard.stageLabel ?? "open"}${p.existingCard.pipelineLabel ? `, ${p.existingCard.pipelineLabel}` : ""}`);
  if (p.action === "create") lines.push(`*Card name:* ${p.cardName}`);
  for (const w of p.warnings) lines.push(`:information_source: ${w}`);
  lines.push("");
  if (p.duplicateOf) {
    lines.push(`:repeat: This meeting was already announced (${link(p.duplicateOf.permalink, "first post")}).`);
  } else if (p.action === "none") {
    lines.push("No card proposed. Reply \"create a card\" in this thread if it is a sales opportunity.");
  } else if (p.missing.length) {
    lines.push(`:warning: Missing: ${p.missing.map((m) => MISSING_LABELS[m]).join("; ")}.`);
    lines.push("Reply in this thread in your own words, then react ✅. If you already reacted ✅, the card is created as soon as it is complete.");
  } else if (p.action === "link") {
    lines.push("React ✅ to link this meeting to the card (no new card), ❌ to skip. Reply \"new card\" to create a separate one.");
  } else {
    lines.push("React ✅ to create the card, ❌ to skip. Something wrong or missing? Reply in this thread in your own words.");
  }
  return stripEmDashes(lines.join("\n"));
}

export type Outcome =
  | { kind: "created"; dealId: string; dealName: string; actor: string; ownerName: string | null; test: boolean }
  | { kind: "linked"; dealId: string | null; dealName: string; actor: string; test: boolean }
  | { kind: "skipped"; actor: string }
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string };

/** Texte qui remplace la proposition une fois la décision prise. */
export function renderOutcome(p: Proposal | null, o: Outcome): string {
  const summary = p ? `${p.contacts[0]?.name ?? "contact"}${p.company.name ? ` (${p.company.name})` : ""}${p.meetingDate ? `, ${formatMeetingDate(p.meetingDate, p.meetingTime)}` : ""}` : "this meeting";
  switch (o.kind) {
    case "created":
      return stripEmDashes(
        [
          `:white_check_mark: *${o.test ? "TEST card created" : "Card created"}* by <@${o.actor}>: ${link(hubspotDealUrl(o.dealId), o.dealName)} · Prospection › R1 scheduled${o.ownerName ? ` · Owner: ${o.ownerName}` : ""}`,
          `Meeting: ${summary}. The Sales Coach will attach the recording of this meeting to this card.`,
          o.test ? ":test_tube: Test: the card is on the test contact, assigned to you." : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    case "linked":
      return stripEmDashes(
        o.test
          ? `:test_tube: *Test*: in live mode this meeting (${summary}) would be linked to ${o.dealId ? link(hubspotDealUrl(o.dealId), o.dealName) : o.dealName}. Nothing was written.`
          : `:link: *Linked* by <@${o.actor}> to ${o.dealId ? link(hubspotDealUrl(o.dealId), o.dealName) : o.dealName}: no new card. Meeting: ${summary}.`,
      );
    case "skipped":
      return `:x: Skipped by <@${o.actor}>: no card created for ${summary}.`;
    case "expired":
      return `:hourglass: Expired: no card created for ${summary}. Post the meeting again, or create the card in HubSpot.`;
    case "cancelled":
      return `:wastebasket: The announcement was deleted: no card created for ${summary}.`;
    case "failed":
      return stripEmDashes(`:warning: Card creation failed for ${summary}: ${o.reason}. Nothing was created. Fix it in this thread and react ✅ again, or create the card in HubSpot.`);
  }
}
