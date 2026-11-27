// Textes Slack du flux #1y-new-meetings (en anglais : c'est le produit).
// La proposition est un seul message du bot, mis à jour à chaque correction,
// puis remplacé par l'issue (carte créée, reliée, refus, expiration).

import { hubspotDealUrl } from "@/lib/hubspot/urls";
import { OFFER_TYPES, dealOriginLabel, type OfferType } from "@/lib/leads/origin";
import { stripEmDashes } from "@/lib/no-em-dash";
import { MEETINGS_CHANNEL_NAME } from "./config";
import type { AnnouncementRow, FieldSource, MissingField, Proposal } from "./types";

const MISSING_LABELS: Record<MissingField, string> = {
  email: "the contact's email",
  owner: "the owner",
  source: "the source (inbound, outbound, referral, event...)",
  partner: "the referring partner",
  company: "the company",
};

/** Ce qui manque, en mots simples (proposition, réponses du fil, rappel). */
export function missingText(missing: readonly MissingField[]): string {
  return missing.map((m) => MISSING_LABELS[m]).join(", ");
}

// Provenance affichée seulement quand elle rassure (lead inbound, HubSpot).
const SOURCE_LABELS: Partial<Record<FieldSource, string>> = {
  lead: "from the inbound lead",
  hubspot: "from HubSpot",
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
        ? `:test_tube: *Test* · post by ${posterName ?? "someone"} in #${MEETINGS_CHANNEL_NAME} (${link(row.slack_permalink, "original")}). A ✅ creates a TEST card, not a real one.`
        : ":test_tube: *Test* · a ✅ creates a TEST card, not a real one.",
    );
  }
  if (p.action === "link" && p.existingCard) lines.push(`:calendar: *New meeting: the card ${link(hubspotDealUrl(p.existingCard.id), p.existingCard.name)} is already open*`);
  else if (p.action === "none") lines.push(p.kind === "partner" ? ":handshake: *Partner meeting?*" : ":speech_balloon: *Meeting noted*");
  else lines.push(":calendar: *New meeting: create the card in Prospection › R1 scheduled?*");
  return lines;
}

/** Message de proposition (mis à jour à chaque correction du fil). */
export function renderProposal(row: AnnouncementRow, p: Proposal, posterName: string | null): string {
  const lines = header(row, p, posterName);
  p.contacts.forEach((c, i) => {
    const who = [c.name, c.title].filter(Boolean).join(", ") || (i === 0 ? "not found" : "?");
    const from = c.emailSource ? SOURCE_LABELS[c.emailSource] : null;
    const email = c.email ? `${c.email}${from ? ` (${from})` : ""}` : i === 0 ? ":warning: *email missing*" : null;
    lines.push(`*${i === 0 ? "Contact" : "Also"}:* ${who}${email ? ` · ${email}` : ""}`);
  });
  if (p.company.name) lines.push(`*Company:* ${p.company.name}${p.company.hubspotCompanyId ? (p.company.hubspotName ? ` (in HubSpot as ${p.company.hubspotName})` : "") : " (new)"}`);
  else lines.push("*Company:* :warning: not found");
  lines.push(`*Meeting:* ${formatMeetingDate(p.meetingDate, p.meetingTime) ?? ":warning: date not found"}`);
  if (p.owner) lines.push(`*Owner:* ${p.owner.name}${p.owner.source === "runner" ? " (runs the meeting)" : ""}${row.mode === "test" ? " · the TEST card is assigned to you" : ""}`);
  else lines.push("*Owner:* :warning: not found");
  const label = p.origin ? dealOriginLabel(p.origin) : null;
  const detail = p.sourceDetail && label && !p.sourceDetail.toLowerCase().includes(label.toLowerCase()) ? ` (${p.sourceDetail})` : "";
  const source = label ? `${label}${detail}` : ":warning: missing";
  lines.push(`*Source:* ${source} · *Offer:* ${p.offerTypes.length ? offerLabels(p.offerTypes) : "not specified"} · *Sale type:* ${p.saleType === "rfp" ? "RFP (tender)" : "Direct"}`);
  if (p.referringPartner) lines.push(`*Referring partner:* ${p.referringPartner}`);
  if (p.lead) {
    const on = p.lead.validatedAt ? new Date(p.lead.validatedAt).toLocaleDateString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short" }) : null;
    lines.push(`*From the inbound lead*${on ? ` of ${on}` : ""} (${link(p.lead.permalink, "lead")})`);
  }
  if (p.existingCard && p.action !== "link") lines.push(`*Open card:* ${link(hubspotDealUrl(p.existingCard.id), p.existingCard.name)}${p.existingCard.stageLabel ? ` (${p.existingCard.stageLabel})` : ""}, a new card will be created anyway.`);
  if (p.existingCard && p.action === "link") lines.push(`*Open card:* ${p.existingCard.stageLabel ?? "open"}${p.existingCard.pipelineLabel ? `, ${p.existingCard.pipelineLabel}` : ""}`);
  if (p.action === "create") lines.push(`*Card name:* ${p.cardName}`);
  for (const w of p.warnings) lines.push(`:information_source: ${w}`);
  lines.push("");
  if (p.duplicateOf) {
    lines.push(`:repeat: Already announced (${link(p.duplicateOf.permalink, "first post")}).`);
  } else if (p.action === "none") {
    lines.push(
      p.kind === "partner"
        ? "Partner meeting: no card. Reply \"create a card\" if it is a sales opportunity."
        : "Not a sales meeting: no card. Reply \"create a card\" if it is one.",
    );
  } else if (p.missing.length) {
    lines.push(`:warning: Missing: ${missingText(p.missing)}.`);
    lines.push("Reply here with it and the card is created.");
  } else if (p.action === "link") {
    lines.push("No new card needed. Separate project? Reply \"new card\".");
  } else {
    lines.push("React ✅ to create the card, ❌ to skip. Something wrong? Reply here.");
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
          `:white_check_mark: *${o.test ? "TEST card created" : "Card created"}* by <@${o.actor}>: ${link(hubspotDealUrl(o.dealId), o.dealName)} · R1 scheduled${o.ownerName ? ` · Owner: ${o.ownerName}` : ""}`,
          `Meeting: ${summary}.`,
          o.test ? ":test_tube: Test card, assigned to you." : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    case "linked":
      return stripEmDashes(
        o.test
          ? `:test_tube: *Test*: this meeting (${summary}) would be linked to ${o.dealId ? link(hubspotDealUrl(o.dealId), o.dealName) : o.dealName}. Nothing was written.`
          : `:link: *Linked* by <@${o.actor}> to ${o.dealId ? link(hubspotDealUrl(o.dealId), o.dealName) : o.dealName}: no new card. Meeting: ${summary}.`,
      );
    case "skipped":
      return `:x: Skipped by <@${o.actor}>: no card created for ${summary}.`;
    case "expired":
      return `:hourglass: Expired: no card created for ${summary}. Post it again, or create the card in HubSpot.`;
    case "cancelled":
      return `:wastebasket: Post deleted: no card created for ${summary}.`;
    case "failed":
      return `:warning: The card could not be created for ${summary}. React ✅ to try again, or create it in HubSpot.`;
  }
}
