// Traitement de fond d'une annonce (fonction meeting-announcement-background).
//
// Sous un bail exclusif (une seule exécution à la fois par annonce) :
// 1. analyse si l'annonce vient d'arriver (IA, enrichissement, message du bot) ;
// 2. événements en file, dans l'ordre des ts Slack (réactions, messages du fil,
//    modification ou suppression de l'annonce) ;
// 3. bail rendu, puis nouvelle vérification de la file (un événement a pu
//    arriver pendant le traitement).

import { stripEmDashes } from "@/lib/no-em-dash";
import { flowMode, testUserSlackId } from "./config";
import { decide, refreshProposal, type DecideContext } from "./confirm";
import { buildProposal } from "./enrich";
import { extractAnnouncement } from "./extract";
import { announcementFiles, announcementText, contentHash, humanizeMentions, quickAnswer, type IncomingSlackMessage } from "./message";
import { renderOutcome, renderProposal } from "./proposal";
import { loadRoster, memberBySlackId, type TeamMember } from "./roster";
import { botReplyInThread, botUserId, replyInThread, updateBotMessage } from "./slack-io";
import { postMessage } from "@/lib/slack/api";
import {
  acquireLease,
  getAnnouncement,
  markEventProcessed,
  patchAnnouncement,
  pendingEvents,
  releaseLease,
  transitionStatus,
  type AnnouncementEvent,
} from "./store";
import { interpretThreadMessage, mergeOverrides } from "./thread";
import { FINAL_STATUSES, OPEN_STATUSES, type AnnouncementRow, type ThreadLogEntry } from "./types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ADMIN_FORCE_NO_EMAIL = /\bcreate without (?:an )?email\b/i;

async function context(): Promise<DecideContext> {
  return {
    roster: await loadRoster(),
    testUserSlackId: await testUserSlackId(),
    siteOrigin: process.env.URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_APP_URL || null,
  };
}

const posterName = (row: AnnouncementRow, roster: TeamMember[]) => memberBySlackId(roster, row.posted_by_slack_id)?.name ?? null;

function namesMap(roster: TeamMember[]): Map<string, string> {
  return new Map(roster.filter((m) => m.slackUserId).map((m) => [m.slackUserId as string, m.name]));
}

// ── 1. Analyse ─────────────────────────────────────────────────────────────

async function postProposal(row: AnnouncementRow, text: string): Promise<{ ts: string; threadTs: string }> {
  if (row.bot_message_ts) {
    await updateBotMessage(row, text);
    return { ts: row.bot_message_ts, threadTs: row.thread_ts };
  }
  if (row.source_kind === "mirror") {
    // Copie dans le DM de test : le message du bot est la racine de la conversation.
    const posted = await postMessage({ channel: row.thread_channel, text });
    return { ts: posted.ts, threadTs: posted.ts };
  }
  // Un essai précédent a pu poster puis planter avant d'enregistrer le ts.
  const existing = await botReplyInThread(row.thread_channel, row.thread_ts, await botUserId());
  if (existing) {
    const withTs = { ...row, bot_message_ts: existing };
    await updateBotMessage(withTs, text);
    return { ts: existing, threadTs: row.thread_ts };
  }
  const posted = await postMessage({ channel: row.thread_channel, thread_ts: row.thread_ts, text });
  return { ts: posted.ts, threadTs: row.thread_ts };
}

async function analyze(row: AnnouncementRow, ctx: DecideContext): Promise<AnnouncementRow> {
  await patchAnnouncement(row.id, { status: "analyzing", attempts: (row.attempts ?? 0) + 1 });
  const text = humanizeMentions(row.text ?? "", namesMap(ctx.roster));
  const extraction = await extractAnnouncement({
    text,
    files: row.files ?? [],
    slackTs: row.slack_ts,
    posterName: posterName(row, ctx.roster),
    posterSlackId: row.posted_by_slack_id,
    roster: ctx.roster,
  });
  const withExtraction = { ...row, extraction, status: "analyzing" as const };
  await patchAnnouncement(row.id, { extraction });

  if (!extraction.is_announcement) {
    await patchAnnouncement(row.id, { status: "ignored" });
    // Une annonce de test écrite dans le DM reçoit une explication ; un vrai message du canal, rien.
    if (row.source_kind === "dm_test") {
      await postMessage({ channel: row.thread_channel, thread_ts: row.thread_ts, text: stripEmDashes(`:test_tube: Test: not read as a meeting announcement (${extraction.reason || "no meeting found"}). Nothing would be posted in #1y-new-meetings.`) }).catch(() => null);
    }
    return { ...withExtraction, status: "ignored" };
  }

  const proposal = await buildProposal(withExtraction, extraction, { roster: ctx.roster, testMode: row.mode === "test", testUserSlackId: ctx.testUserSlackId });
  const status = proposal.duplicateOf ? "duplicate" : "proposed";
  const draft = { ...withExtraction, proposal, status } as AnnouncementRow;
  const posted = await postProposal(draft, renderProposal(draft, proposal, posterName(row, ctx.roster)));
  const patch: Partial<AnnouncementRow> = {
    status,
    proposal,
    proposal_version: proposal.version,
    bot_message_ts: posted.ts,
    thread_ts: posted.threadTs,
    meeting_date: proposal.meetingDate,
    owner_user_id: proposal.owner?.userId ?? null,
    owner_hubspot_id: proposal.owner?.hubspotOwnerId ?? null,
    hubspot_company_id: proposal.company.hubspotCompanyId,
    lead_id: proposal.lead?.id ?? null,
    contact_emails: proposal.contacts.map((c) => c.email).filter((e): e is string => !!e),
  };
  await patchAnnouncement(row.id, patch);
  return { ...draft, ...patch } as AnnouncementRow;
}

// ── 2. Événements ──────────────────────────────────────────────────────────

async function appendLog(row: AnnouncementRow, entry: ThreadLogEntry): Promise<AnnouncementRow> {
  const thread_log = [...(row.thread_log ?? []), entry].slice(-50);
  await patchAnnouncement(row.id, { thread_log });
  return { ...row, thread_log };
}

async function handleThreadMessage(row: AnnouncementRow, ev: AnnouncementEvent, ctx: DecideContext): Promise<string> {
  const user = ev.slack_user_id;
  const text = String((ev.payload?.text as string | undefined) ?? "").trim();
  if (!user || !text) return "ignored: empty";
  const author = memberBySlackId(ctx.roster, user);
  const allowed = !!row.proposal?.allowedSlackUserIds.includes(user);
  const baseEntry = { ts: ev.slack_ts ?? "", user: author?.name ?? user, text: text.slice(0, 1000), allowed };

  if (!allowed) {
    await appendLog(row, { ...baseEntry, action: "note (not allowed to change the card)" });
    return "noted: not allowed";
  }
  if (!row.extraction) return "ignored: not analyzed yet";

  const afterCreation = row.status === "created" || row.status === "linked";
  if (FINAL_STATUSES.has(row.status) && !afterCreation) {
    await appendLog(row, { ...baseEntry, action: `note (announcement ${row.status})` });
    return `noted: ${row.status}`;
  }

  // Réponses courtes : pas d'appel IA.
  const quick = afterCreation ? null : quickAnswer(text);
  if (quick) {
    const next = await appendLog(row, { ...baseEntry, action: quick === "yes" ? "confirm" : "cancel" });
    return decide(next, quick, user, ctx);
  }

  // Admin : créer sans email (le Sales Coach ne pourra pas rattacher seul).
  if (!afterCreation && ADMIN_FORCE_NO_EMAIL.test(text)) {
    if (!author?.isAdmin) {
      await replyInThread(row, "Only an admin can create a card without the contact's email.");
      return "refused: force without email (not admin)";
    }
    const next = await appendLog(row, { ...baseEntry, action: "update: create without email" });
    const { row: refreshed } = await refreshProposal({ ...next, overrides: { ...next.overrides, forceNoEmail: true } }, ctx);
    await patchAnnouncement(row.id, { overrides: { ...next.overrides, forceNoEmail: true } });
    await replyInThread(refreshed, "OK: the card can be created without the email. The Sales Coach will not attach the recording automatically.");
    if (refreshed.confirm_intent_by) return decide(refreshed, "yes", refreshed.confirm_intent_by, ctx);
    return "updated: force without email";
  }

  const decision = await interpretThreadMessage({
    text: humanizeMentions(text, namesMap(ctx.roster)),
    messageTs: ev.slack_ts ?? row.slack_ts,
    authorName: author?.name ?? "the sales rep",
    announcementText: row.text ?? "",
    proposal: row.proposal,
    history: row.thread_log ?? [],
    roster: ctx.roster,
    afterCreation,
  });
  let next = await appendLog(row, { ...baseEntry, action: `${decision.intent}${Object.keys(decision.overrides).length ? `: ${Object.keys(decision.overrides).join(", ")}` : ""}` });

  if (afterCreation) {
    if (decision.meetingDate || decision.meetingTime) {
      await patchAnnouncement(row.id, { meeting_date: decision.meetingDate ?? row.meeting_date });
      await replyInThread(next, decision.reply || "Noted: meeting date updated. The card itself is unchanged.");
      return "updated: meeting date after creation";
    }
    if (decision.intent === "cancel") {
      await replyInThread(next, "Noted. The card stays open in HubSpot: close it there if the meeting is cancelled for good.");
      return "noted: cancel after creation";
    }
    if (decision.intent === "question" && decision.reply) await replyInThread(next, decision.reply);
    if (decision.intent === "note") await patchAnnouncement(row.id, { notes: [row.notes, text].filter(Boolean).join("\n").slice(-4000) });
    return `after creation: ${decision.intent}`;
  }

  if (decision.intent === "cancel") return decide(next, "no", user, ctx);

  if (Object.keys(decision.overrides).length) {
    const overrides = mergeOverrides(next.overrides ?? {}, decision.overrides);
    await patchAnnouncement(row.id, { overrides });
    next = { ...next, overrides };
    const { row: refreshed, proposal } = await refreshProposal(next, ctx);
    next = refreshed;
    const still = proposal.missing.length ? ` Still missing: ${proposal.missing.join(", ")}.` : "";
    if (decision.intent !== "confirm") await replyInThread(next, `${decision.reply || "Updated."}${still}`);
    // ✅ déjà donné alors qu'il manquait un champ : la carte part dès que tout est là.
    if (next.confirm_intent_by && !proposal.missing.length) return decide(next, "yes", next.confirm_intent_by, ctx);
  } else if (decision.intent === "question" && decision.reply) {
    await replyInThread(next, decision.reply);
  } else if (decision.intent === "note") {
    await patchAnnouncement(row.id, { notes: [row.notes, text].filter(Boolean).join("\n").slice(-4000) });
  }

  if (decision.intent === "confirm") return decide(next, "yes", user, ctx);
  return `thread: ${decision.intent}`;
}

async function handleEdited(row: AnnouncementRow, ev: AnnouncementEvent, ctx: DecideContext): Promise<string> {
  if (FINAL_STATUSES.has(row.status) || row.status === "creating") return `ignored: edit after ${row.status}`;
  const msg = (ev.payload?.message ?? {}) as IncomingSlackMessage;
  const text = announcementText(msg);
  const files = announcementFiles(msg);
  const hash = contentHash(text, files);
  if (hash === row.text_hash) return "ignored: same content";
  await patchAnnouncement(row.id, { text, files, text_hash: hash });
  // Nouvelle analyse de l'annonce ; les corrections du fil (overrides) restent prioritaires.
  const fresh = (await getAnnouncement(row.id)) as AnnouncementRow;
  const text2 = humanizeMentions(text, namesMap(ctx.roster));
  const extraction = await extractAnnouncement({ text: text2, files, slackTs: row.slack_ts, posterName: posterName(row, ctx.roster), posterSlackId: row.posted_by_slack_id, roster: ctx.roster });
  await patchAnnouncement(row.id, { extraction });
  if (!row.bot_message_ts) return "edited before the proposal";
  await refreshProposal({ ...fresh, extraction }, ctx);
  await replyInThread(fresh, "Updated from your edit of the post.");
  return "edited: proposal refreshed";
}

async function handleDeleted(row: AnnouncementRow): Promise<string> {
  if (FINAL_STATUSES.has(row.status) || row.status === "creating") return `ignored: delete after ${row.status}`;
  const done = await transitionStatus(row.id, [...OPEN_STATUSES, "received", "analyzing"], "cancelled");
  if (done?.bot_message_ts) await updateBotMessage(done, renderOutcome(row.proposal, { kind: "cancelled" }));
  return "cancelled: post deleted";
}

async function handleEvent(row: AnnouncementRow, ev: AnnouncementEvent, ctx: DecideContext): Promise<string> {
  switch (ev.kind) {
    case "reaction": {
      const answer = ev.payload?.answer === "yes" ? "yes" : ev.payload?.answer === "no" ? "no" : null;
      if (!answer || !ev.slack_user_id) return "ignored: bad reaction";
      return decide(row, answer, ev.slack_user_id, ctx);
    }
    case "thread_message":
      return handleThreadMessage(row, ev, ctx);
    case "edited":
      return handleEdited(row, ev, ctx);
    case "deleted":
      return handleDeleted(row);
  }
}

// ── Point d'entrée ─────────────────────────────────────────────────────────

export async function processAnnouncement(id: string): Promise<void> {
  for (let round = 0; round < 3; round++) {
    let row = await acquireLease(id);
    if (!row) return; // une autre exécution travaille déjà sur cette annonce
    try {
      if ((await flowMode()) === "off" && row.mode === "live") {
        console.log(`[meetings/${id}] flow off: nothing done`);
        return;
      }
      const ctx = await context();
      if (row.status === "received" || row.status === "analyzing") {
        try {
          row = await analyze(row, ctx);
        } catch (e) {
          console.error(`[meetings/${id}] analysis failed:`, errMsg(e));
          await patchAnnouncement(id, { status: "received", error: errMsg(e).slice(0, 500) });
          return; // le balayage planifié relancera
        }
      }
      for (const ev of await pendingEvents(id)) {
        const fresh = (await getAnnouncement(id)) as AnnouncementRow;
        let result: string;
        try {
          result = await handleEvent(fresh, ev, ctx);
        } catch (e) {
          result = `error: ${errMsg(e)}`;
          console.error(`[meetings/${id}] event ${ev.event_id} (${ev.kind}) failed:`, errMsg(e));
        }
        await markEventProcessed(ev.event_id, result);
        console.log(`[meetings/${id}] ${ev.kind}: ${result}`);
      }
    } finally {
      await releaseLease(id);
    }
    if (!(await pendingEvents(id)).length) return;
  }
}
