/**
 * Banc de test du flux #1y-new-meetings (lecture seule : rien n'est posté,
 * rien n'est écrit dans HubSpot ni en base).
 *
 *   replay [--days 30] [--limit 40]   rejoue les vraies annonces récentes de #1y :
 *                                     analyse IA + enrichissement, tableau du résultat
 *   simulate --text "Rendez-vous pris avec ..." [--poster U123]
 *                                     analyse un texte, affiche la proposition Slack
 *
 * Lancement : node --env-file=.env.local --no-warnings --import ./scripts/ts-hooks/register.mjs scripts/test-meeting-announcement.mts replay
 */
import { MEETINGS_CHANNEL_ID } from "@/lib/meetings/config";
import { buildProposal } from "@/lib/meetings/enrich";
import { extractAnnouncement } from "@/lib/meetings/extract";
import { announcementFiles, announcementText, humanizeMentions, type IncomingSlackMessage } from "@/lib/meetings/message";
import { renderProposal } from "@/lib/meetings/proposal";
import { loadRoster, memberBySlackId, type TeamMember } from "@/lib/meetings/roster";
import type { AnnouncementRow } from "@/lib/meetings/types";
import { slackBotGet } from "@/lib/slack/search";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function fakeRow(ts: string, poster: string | null, text: string): AnnouncementRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    created_at: new Date(Number(ts) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    slack_channel_id: MEETINGS_CHANNEL_ID,
    slack_ts: ts,
    slack_permalink: null,
    source_kind: "channel",
    posted_by_slack_id: poster,
    posted_by_user_id: null,
    text,
    files: null,
    text_hash: null,
    thread_channel: MEETINGS_CHANNEL_ID,
    thread_ts: ts,
    bot_message_ts: null,
    mode: "live",
    status: "analyzing",
    lease_until: null,
    attempts: 0,
    extraction: null,
    proposal: null,
    proposal_version: 0,
    overrides: {},
    thread_log: [],
    notes: null,
    confirm_intent_by: null,
    confirm_intent_at: null,
    owner_user_id: null,
    owner_hubspot_id: null,
    contact_emails: [],
    hubspot_contact_ids: [],
    hubspot_company_id: null,
    meeting_date: null,
    meeting_at: null,
    hubspot_deal_id: null,
    deal_link_origin: null,
    lead_id: null,
    reminder_sent_at: null,
    decided_by: null,
    decided_at: null,
    error: null,
  };
}

async function analyzeOne(roster: TeamMember[], msg: IncomingSlackMessage) {
  const names = new Map(roster.filter((m) => m.slackUserId).map((m) => [m.slackUserId as string, m.name]));
  const raw = announcementText(msg);
  const text = humanizeMentions(raw, names);
  const row = fakeRow(msg.ts as string, msg.user ?? null, raw);
  const extraction = await extractAnnouncement({ text, files: announcementFiles(msg), slackTs: msg.ts as string, posterName: memberBySlackId(roster, msg.user)?.name ?? null, posterSlackId: msg.user ?? null, roster });
  if (!extraction.is_announcement) return { row, extraction, proposal: null };
  const proposal = await buildProposal({ ...row, extraction }, extraction, { roster, testMode: false, testUserSlackId: null });
  return { row: { ...row, extraction, proposal }, extraction, proposal };
}

const roster = await loadRoster();

if (cmd === "replay") {
  const days = Number(opt("days") ?? 30);
  const limit = Number(opt("limit") ?? 40);
  const oldest = String(Math.floor(Date.now() / 1000 - days * 86400));
  const res = await slackBotGet<{ messages?: IncomingSlackMessage[] }>("/conversations.history", { channel: MEETINGS_CHANNEL_ID, oldest, limit: String(Math.min(200, limit * 2)) });
  if (!res.ok) throw new Error(`Slack: ${res.error}`);
  const posts = (res.messages ?? []).filter((m) => !m.bot_id && (!m.subtype || m.subtype === "file_share") && (!m.thread_ts || m.thread_ts === m.ts)).slice(0, limit);
  console.log(`${posts.length} posts in #1y-new-meetings over ${days} days\n`);
  let announcements = 0;
  let withEmail = 0;
  for (const m of posts) {
    try {
      const { extraction, proposal } = await analyzeOne(roster, m);
      const excerpt = announcementText(m).replace(/\s+/g, " ").slice(0, 90);
      if (!proposal) {
        console.log(`· IGNORED  "${excerpt}"  -> ${extraction.reason}`);
        continue;
      }
      announcements++;
      const c = proposal.contacts[0];
      if (c?.email) withEmail++;
      console.log(
        [
          `· ${proposal.action.toUpperCase().padEnd(6)} "${excerpt}"`,
          `    contact: ${c?.name ?? "-"}${c?.title ? `, ${c.title}` : ""} · email: ${c?.email ?? "MISSING"}${c?.emailSource ? ` (${c.emailSource})` : ""}`,
          `    company: ${proposal.company.name ?? "-"}${proposal.company.hubspotCompanyId ? " (HubSpot)" : " (new)"} · meeting: ${proposal.meetingDate ?? "-"}${proposal.meetingTime ? ` ${proposal.meetingTime}` : ""} · owner: ${proposal.owner?.name ?? "-"}`,
          `    source: ${proposal.origin ?? "MISSING"}${proposal.sourceDetail ? ` (${proposal.sourceDetail})` : ""} · kind: ${proposal.kind}${proposal.lead ? " · from inbound lead" : ""}${proposal.existingCard ? ` · open card: ${proposal.existingCard.name} (${proposal.existingCard.stageLabel ?? "?"})` : ""}`,
          proposal.missing.length ? `    missing: ${proposal.missing.join(", ")}` : null,
          proposal.warnings.length ? `    warnings: ${proposal.warnings.join(" | ")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (e) {
      console.log(`· ERROR on ${m.ts}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n${announcements} announcement(s), ${withEmail} with an email found automatically.`);
} else if (cmd === "simulate") {
  const text = opt("text");
  if (!text) throw new Error('--text "..." is required');
  const poster = opt("poster") ?? roster.find((m) => /arthur/i.test(m.name) && m.slackUserId && m.hubspotOwnerId)?.slackUserId ?? null;
  const ts = (Date.now() / 1000).toFixed(6);
  const { row, extraction, proposal } = await analyzeOne(roster, { ts, user: poster ?? undefined, text });
  console.log("Extraction:", JSON.stringify(extraction, null, 1));
  if (proposal) console.log(`\n--- Slack message ---\n${renderProposal(row, proposal, memberBySlackId(roster, poster)?.name ?? null)}`);
} else {
  console.log("Usage: replay [--days 30] [--limit 40] | simulate --text \"...\" [--poster U123]");
}
