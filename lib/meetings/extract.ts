// Analyse IA d'une annonce de #1y-new-meetings : est-ce un meeting pris avec
// un externe, avec qui, chez qui, quand, et comment il a été obtenu.
// L'IA ne fait que lire : elle n'invente ni email, ni nom, ni date. La Source
// est une clé, traduite en valeur HubSpot exacte par le code (enrich.ts).

import type Anthropic from "@anthropic-ai/sdk";
import { isOfferType } from "@/lib/leads/origin";
import { stripEmDashes } from "@/lib/no-em-dash";
import { fetchSlackImages } from "@/lib/slack/images";
import { callStructured } from "./llm";
import type { TeamMember } from "./roster";
import { SOURCE_KEYS, type Extraction, type SlackFileRef, type SourceKey } from "./types";

const SYSTEM = `You read a Slack message posted by a Coachello sales rep in the channel #1y-new-meetings, where reps announce the meetings they booked. Coachello sells digital coaching (human coaching and AI role-play) to HR and L&D leaders.

Decide whether the message announces a booked meeting with someone outside Coachello. Congratulations, jokes, reminders, comments on other meetings or channel events are NOT announcements.

Read only what the message and its screenshots say. Never invent an email, a name, a company or a date: use an empty string when it is unknown.

Fields:
- contacts: the external people of the meeting, never Coachello colleagues (the team list is given). first_name, last_name, title (job title), email (only if written in the message or visible in a screenshot). A role without a name ("CEO", "Head of Talent") gives a contact with only a title.
- company_name: the external company. company_website: a link or domain given for it.
- meeting_date: YYYY-MM-DD, resolved against the posting date given below. French dates are day/month ("le 04/12" = 4 December). "on Friday", "this Tuesday" = the next such day after the posting date. A date without a year is the next occurrence after the posting date, unless it falls less than two months before the posting date (a late announcement of a past meeting): then it is that past date. Empty if there is no date.
- meeting_time: HH:MM (24h) if a time is given, else empty.
- runner_slack_id: if the message says a mentioned colleague will run the meeting ("meeting avec @Amélie", "for @Leon"), that colleague's Slack id; else empty.
- meeting_kind: prospect (a sales opportunity), partner (a partnership discussion, no sale), client (an existing customer: upsell, renewal, follow-up), other.
- source_key: how the meeting was obtained, from the hint in the message.
  outbound = cold call, cold email, LinkedIn outreach, prospecting campaign;
  inbound = the prospect came to Coachello (website, form, inbound call or email, "incoming lead");
  referral = recommended by someone; network = personal network;
  events = met at an event, trade show, conference or webinar, or the follow-up of one ("Unleash FUP");
  partner_coprospecting = prospected together with a partner; partner_inbound = lead sent by a partner;
  existing_customer = an existing client; unknown = no hint.
- source_detail: the channel in a few English words ("cold call", "LinkedIn", "Unleash follow-up"), else empty.
- referring_partner: the partner's name if a partner brought the lead, else empty.
- offer_types: "ai-roleplay" and/or "human-coaching", only if explicitly mentioned.
- is_rfp: true only if an RFP, a tender or an "appel d'offres" is mentioned.
- reason: one short English sentence explaining your decision.
- notes: anything else useful to the sales rep, in English, else empty.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_announcement: { type: "boolean" },
    reason: { type: "string" },
    meeting_kind: { type: "string", enum: ["prospect", "partner", "client", "other"] },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { first_name: { type: "string" }, last_name: { type: "string" }, title: { type: "string" }, email: { type: "string" } },
        required: ["first_name", "last_name", "title", "email"],
      },
    },
    company_name: { type: "string" },
    company_website: { type: "string" },
    meeting_date: { type: "string" },
    meeting_time: { type: "string" },
    runner_slack_id: { type: "string" },
    source_key: { type: "string", enum: [...SOURCE_KEYS] },
    source_detail: { type: "string" },
    referring_partner: { type: "string" },
    offer_types: { type: "array", items: { type: "string", enum: ["ai-roleplay", "human-coaching"] } },
    is_rfp: { type: "boolean" },
    notes: { type: "string" },
  },
  required: [
    "is_announcement",
    "reason",
    "meeting_kind",
    "contacts",
    "company_name",
    "company_website",
    "meeting_date",
    "meeting_time",
    "runner_slack_id",
    "source_key",
    "source_detail",
    "referring_partner",
    "offer_types",
    "is_rfp",
    "notes",
  ],
} as const;

const clean = (s: unknown) => stripEmDashes(typeof s === "string" ? s.trim() : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (s: unknown) => {
  const e = clean(s).toLowerCase().replace(/^mailto:/, "");
  return EMAIL.test(e) ? e : "";
};
export const cleanDate = (s: unknown) => {
  const d = clean(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) ? d : "";
};
export const cleanTime = (s: unknown) => {
  const t = clean(s);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : "";
};

/** Normalise la sortie du modèle : rien de ce qui en sort n'est cru sur parole. */
export function sanitizeExtraction(raw: Partial<Extraction> | null | undefined): Extraction {
  const r = raw ?? {};
  const kind = r.meeting_kind && ["prospect", "partner", "client", "other"].includes(r.meeting_kind) ? r.meeting_kind : "other";
  const source = (SOURCE_KEYS as readonly string[]).includes(r.source_key ?? "") ? (r.source_key as SourceKey) : "unknown";
  return {
    is_announcement: r.is_announcement === true,
    reason: clean(r.reason),
    meeting_kind: kind,
    contacts: (Array.isArray(r.contacts) ? r.contacts : [])
      .map((c) => ({ first_name: clean(c?.first_name), last_name: clean(c?.last_name), title: clean(c?.title), email: cleanEmail(c?.email) }))
      .filter((c) => c.first_name || c.last_name || c.title || c.email)
      .slice(0, 5),
    company_name: clean(r.company_name),
    company_website: clean(r.company_website),
    meeting_date: cleanDate(r.meeting_date),
    meeting_time: cleanTime(r.meeting_time),
    runner_slack_id: /^[UW][A-Z0-9]+$/.test(clean(r.runner_slack_id)) ? clean(r.runner_slack_id) : "",
    source_key: source,
    source_detail: clean(r.source_detail),
    referring_partner: clean(r.referring_partner),
    offer_types: [...new Set((Array.isArray(r.offer_types) ? r.offer_types : []).filter(isOfferType))],
    is_rfp: r.is_rfp === true,
    notes: clean(r.notes),
  };
}

/** Date et jour de la semaine (Paris) d'un ts Slack, référence des dates relatives. */
export function postedOnParis(slackTs: string): string {
  const d = new Date(Number(slackTs) * 1000);
  return d.toLocaleString("en-GB", { timeZone: "Europe/Paris", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export async function extractAnnouncement(input: {
  text: string;
  files: SlackFileRef[];
  slackTs: string;
  posterName: string | null;
  posterSlackId: string | null;
  roster: TeamMember[];
}): Promise<Extraction> {
  const images = await fetchSlackImages(input.files);
  const team = input.roster
    .filter((m) => m.slackUserId)
    .map((m) => `${m.name} (Slack id ${m.slackUserId})`)
    .join("; ");
  const prompt = [
    `Posted by: ${input.posterName ?? "unknown"}${input.posterSlackId ? ` (Slack id ${input.posterSlackId})` : ""}`,
    `Posted on: ${postedOnParis(input.slackTs)} (Paris time)`,
    `Coachello team (colleagues, never prospects): ${team}`,
    images.length ? `${images.length} screenshot(s) attached above.` : "No screenshot.",
    "",
    "Message:",
    `"""${input.text}"""`,
  ].join("\n");
  const content: Anthropic.ContentBlockParam[] = [
    ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.media_type, data: img.data } })),
    { type: "text", text: prompt },
  ];
  const raw = await callStructured<Partial<Extraction>>({ system: SYSTEM, content, schema: SCHEMA as unknown as Record<string, unknown>, label: "extract", maxTokens: 3000 });
  const extraction = sanitizeExtraction(raw);
  // Garde-fou : un meeting annoncé à plus de 10 mois est une date passée lue dans l'année suivante.
  if (extraction.meeting_date) {
    const posted = Number(input.slackTs) * 1000;
    const d = new Date(`${extraction.meeting_date}T12:00:00Z`);
    if (d.getTime() - posted > 300 * 86_400_000) {
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      extraction.meeting_date = d.toISOString().slice(0, 10);
    }
  }
  return extraction;
}
