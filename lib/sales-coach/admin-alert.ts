/**
 * Slack alert posted when a Claap webhook arrives but no HubSpot deal can be
 * resolved (4-stage resolver came back empty). The analysis is paused with
 * status `awaiting_manual_deal` and the recipient is invited to associate the
 * deal manually from the Sales Coach UI.
 *
 * Routing aligned with the meeting recap :
 *  - SLACK_MODE=test (default) -> DM Arthur only, with a test header listing
 *    who would have received the alert in prod mode.
 *  - SLACK_MODE=prod -> DM every Coachello participant of the meeting
 *    (recorder + organizer + any other internal attendee) AND Arthur in copy.
 *    Falls back to Arthur alone if no internal participant could be resolved
 *    (jamais d'envoi vide).
 */

import {
  dmRecipient,
  findArthurFallbackRecipient,
  resolveMeetingParticipantRecipients,
  type MeetingRecipient,
} from "./slack-recipients";

export type ManualDealAlertContext = {
  analysisId: string;
  claapRecordingId: string | null;
  meetingTitle: string | null;
  meetingStartedAt: string | null;
  recorderEmail: string | null;
  participantEmails: string[];
};

export async function sendManualDealAlert(
  ctx: ManualDealAlertContext,
): Promise<{ ok: boolean; destination?: string; error?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: false, error: "SLACK_BOT_TOKEN missing" };
  }

  const mode = process.env.SLACK_MODE === "prod" ? "prod" : "test";

  // Participants Coachello internes du meeting (recorder inclus s'il est
  // présent). On cible tout le monde côté Coachello, pas seulement le recorder,
  // parce que l'organizer (souvent ≠ recorder) doit aussi pouvoir associer le
  // deal.
  const internalRecipients: MeetingRecipient[] = ctx.claapRecordingId
    ? await resolveMeetingParticipantRecipients(
        ctx.claapRecordingId,
        ctx.recorderEmail,
      ).catch((e) => {
        console.warn(
          `[manual-deal-alert/${ctx.analysisId}] participant resolution failed:`,
          e,
        );
        return [] as MeetingRecipient[];
      })
    : [];

  const arthur = await findArthurFallbackRecipient();

  let recipients: MeetingRecipient[];
  let isFallback = false;

  if (mode === "test") {
    if (!arthur) {
      return {
        ok: false,
        error: `Slack user "${process.env.CLAAP_NOTE_SLACK_TEST_USER ?? "Arthur Czernichow"}" not found (mode=test)`,
      };
    }
    recipients = [arthur];
  } else if (internalRecipients.length > 0) {
    // Mode prod : tous les internes + Arthur en copie (dédupliqué au cas où
    // Arthur figure parmi les participants).
    const seen = new Set<string>();
    recipients = [];
    for (const r of internalRecipients) {
      if (!seen.has(r.memberId)) {
        seen.add(r.memberId);
        recipients.push(r);
      }
    }
    if (arthur && !seen.has(arthur.memberId)) {
      recipients.push(arthur);
    }
  } else {
    // Mode prod mais aucun participant interne détecté côté Claap : on tombe
    // sur Arthur seul pour ne jamais perdre l'alerte.
    if (!arthur) {
      return {
        ok: false,
        error: "No Coachello participants in meeting and fallback user not found",
      };
    }
    recipients = [arthur];
    isFallback = true;
    console.warn(
      `[manual-deal-alert/${ctx.analysisId}] no Coachello participant detected -- falling back to Arthur`,
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const date = ctx.meetingStartedAt
    ? new Date(ctx.meetingStartedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
    : null;
  const participantsLine = ctx.participantEmails.length > 0
    ? ctx.participantEmails.join(", ")
    : "(no external participant identified)";

  const lines: string[] = [
    `:warning: *Claap meeting with no HubSpot deal* - manual association needed`,
    ``,
    `*Meeting:* ${ctx.meetingTitle ?? "Untitled"}${date ? ` · ${date}` : ""}`,
    `*External participants:* ${participantsLine}`,
  ];
  if (ctx.recorderEmail) {
    lines.push(`*Recorder:* ${ctx.recorderEmail}`);
  }
  if (appUrl) {
    lines.push(``, `<${appUrl}/sales-coach?id=${ctx.analysisId}|Link a deal and start the analysis →>`);
  }
  const body = lines.join("\n");

  // Header de test qui explicite qui recevrait l'alerte en mode prod. Aligne
  // le manual-deal alert sur le format du recap.
  const text = mode === "test"
    ? `${formatTestHeader(internalRecipients, arthur)}\n\n${body}`
    : body;

  let sentCount = 0;
  const failures: string[] = [];

  for (const r of recipients) {
    try {
      await dmRecipient(r.memberId, text);
      sentCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${r.email}: ${msg}`);
    }
  }

  if (sentCount === 0) {
    return { ok: false, error: failures.join("; ") || "no recipient reachable" };
  }

  const destination = `${recipients.map((r) => r.email).join(", ")}${isFallback ? " (fallback)" : ""}`;
  return { ok: true, destination };
}

function formatTestHeader(
  internal: MeetingRecipient[],
  arthur: MeetingRecipient | null,
): string {
  if (internal.length === 0) {
    return ":test_tube: *Test* - fallback: no Coachello participant detected, in prod mode the alert would go to Arthur only.";
  }
  const targets = [...internal.map((r) => r.email)];
  if (arthur && !internal.some((r) => r.memberId === arthur.memberId)) {
    targets.push(`${arthur.email} (cc)`);
  }
  return `:test_tube: *Test* - in prod mode, this alert would be sent as a DM to: ${targets.join(", ")}`;
}
