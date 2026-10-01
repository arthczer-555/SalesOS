import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnySalesCoachAnalysis,
  ClientMeetingKind,
  MeetingKind,
} from "@/lib/guides/sales-coach";
import {
  CLIENT_MEETING_KIND_LABELS,
  CLIENT_MEETING_KIND_LABELS_FR,
  MEETING_KIND_LABELS,
  MEETING_KIND_LABELS_FR,
  extractStringArray,
  repairAnalysis,
} from "@/lib/guides/sales-coach";
import type { DealSnapshot } from "@/lib/hubspot";
import { detectOutputLang, type OutputLang } from "./language";
import type { Audience } from "./meeting-recap";
import {
  dedupeRecipients,
  dmRecipient,
  findArthurFallbackRecipient,
  formatTestModeHeader,
  resolveMeetingParticipantRecipients,
  type MeetingRecipient,
} from "./slack-recipients";

/**
 * Rend le debrief Slack post-analyse, aligné sur la page synthèse de l'app.
 * Contient : header (deal, meeting, score), summary, strengths, weaknesses,
 * coaching_priorities, lien vers l'analyse complète. Les blocs détaillés
 * (axes, MEDDIC, BOSCHE, customer_health, key_moments, talk_ratio) restent
 * réservés à la page synthèse pour garder le DM scannable en 30 secondes.
 */
function formatAnalysisDebrief(args: {
  audience: Audience;
  lang: OutputLang;
  dealName: string;
  dealStage: string | null;
  meetingTitle: string;
  meetingStartedAt: string | null;
  meetingKind: MeetingKind | ClientMeetingKind | null;
  scoreGlobal: number;
  analysis: AnySalesCoachAnalysis;
  appUrl: string;
  analysisId: string;
  salesName: string | null;
}): string {
  const {
    audience,
    lang,
    dealName,
    dealStage,
    meetingTitle,
    meetingStartedAt,
    meetingKind,
    scoreGlobal,
    analysis,
    appUrl,
    analysisId,
    salesName,
  } = args;
  const isClient = audience === "client";

  // Labels Slack dans la langue du contenu (`lang`, décidée par l'appelant) :
  // meeting FR -> labels FR, meeting EN -> labels EN.
  const strengthsRaw = extractStringArray(analysis.strengths);
  const weaknessesRaw = extractStringArray(analysis.weaknesses);
  const prioritiesRaw = extractStringArray(analysis.coaching_priorities);
  const t = lang === "fr"
    ? {
        debrief: "DEBRIEF COACHING",
        csDebrief: "DEBRIEF COACHING CS",
        score: "Score global",
        summary: "Résumé",
        strengths: "Points forts",
        weaknesses: "À travailler",
        prioritiesClient: "Top 3 actions pour le prochain point",
        prioritiesProspect: "Top 3 actions pour le prochain call",
        viewFull: "Voir l'analyse complète",
      }
    : {
        debrief: "COACHING DEBRIEF",
        csDebrief: "CS COACHING DEBRIEF",
        score: "Overall score",
        summary: "Summary",
        strengths: "Strengths",
        weaknesses: "Areas to improve",
        prioritiesClient: "Top 3 actions for the next touchpoint",
        prioritiesProspect: "Top 3 actions for the next call",
        viewFull: "View full analysis",
      };

  const date = meetingStartedAt
    ? new Date(meetingStartedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
    : "";
  const kindLabels = isClient
    ? (lang === "fr" ? CLIENT_MEETING_KIND_LABELS_FR : CLIENT_MEETING_KIND_LABELS)
    : (lang === "fr" ? MEETING_KIND_LABELS_FR : MEETING_KIND_LABELS);
  const kindLabel = meetingKind
    ? (kindLabels as Record<string, string>)[meetingKind] ?? null
    : null;

  const headerEmoji = isClient ? ":handshake:" : ":dart:";
  const headerTitle = isClient ? t.csDebrief : t.debrief;
  const prioritiesLabel = isClient ? t.prioritiesClient : t.prioritiesProspect;

  const dealLabel = dealName.trim();
  const headerLine = `${headerEmoji} *${headerTitle}${dealLabel ? ` : ${dealLabel}` : ""}*${dealStage ? ` · _${dealStage}_` : ""}`;

  const subtitleParts: string[] = [];
  if (meetingTitle) subtitleParts.push(meetingTitle);
  if (date) subtitleParts.push(date);
  if (salesName) subtitleParts.push(salesName);
  if (kindLabel) subtitleParts.push(`_${kindLabel}_`);

  const lines: string[] = [headerLine];
  if (subtitleParts.length > 0) lines.push(subtitleParts.join(" · "));
  lines.push(``, `*${t.score}:* ${scoreGlobal}/10`);

  if (analysis.summary?.trim()) {
    lines.push(``, `*${t.summary}*`, analysis.summary.trim());
  }

  // extractStringArray (fait plus haut), parce que Haiku char-by-char
  // stringifie parfois ces champs en objet numeric-keyed (`{"0":"T",...}`). Le
  // validator ne couvre pas ces 3 champs, donc l'analyse peut être saved en
  // `done` avec un shape cassé. Cohérent avec le rendu UI (analysis-detail).
  const strengths = strengthsRaw.map((s) => s.trim()).filter(Boolean);
  if (strengths.length > 0) {
    lines.push(``, `*${t.strengths}*`);
    for (const s of strengths) lines.push(`• ${s}`);
  }

  const weaknesses = weaknessesRaw.map((w) => w.trim()).filter(Boolean);
  if (weaknesses.length > 0) {
    lines.push(``, `*${t.weaknesses}*`);
    for (const w of weaknesses) lines.push(`• ${w}`);
  }

  const priorities = prioritiesRaw.map((p) => p.trim()).filter(Boolean);
  if (priorities.length > 0) {
    lines.push(``, `:rocket: *${prioritiesLabel}*`);
    priorities.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  }

  if (appUrl) {
    lines.push(``, `<${appUrl}/sales-coach?id=${analysisId}|${t.viewFull}>`);
  }

  return lines.join("\n");
}

/**
 * Envoie le debrief coaching en DM Slack.
 *
 * - Mode `test` (défaut) : DM à Arthur uniquement, préfixé d'un header
 *   `:test_tube: *Test*` qui montre à qui le DM partirait en mode prod (pour
 *   valider le routing avant la bascule).
 * - Mode `prod` : DM à chaque participant Coachello présent dans le meeting
 *   Claap (même domaine que le recorder). Pas de fallback sur le deal owner,
 *   si la personne n'était pas dans le meeting, elle ne reçoit pas. Si aucun
 *   participant détecté : fallback Arthur.
 */
export async function sendSalesCoachSlack(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("id, user_id, hubspot_deal_id, meeting_title, meeting_started_at, meeting_kind, audience, analysis, score_global, deal_snapshot, claap_recording_id, recorder_email, transcript_text")
    .eq("id", analysisId)
    .single();

  if (!row) return { ok: false, error: "Analysis not found" };
  if (!row.analysis) return { ok: false, error: "Analysis data missing" };

  const mode = process.env.SLACK_MODE === "prod" ? "prod" : "test";
  const audience = (row.audience as Audience | null) ?? null;

  // Résout d'abord les participants Coachello du meeting. Utilisé :
  //  - en mode channels : pour DM directement chacun
  //  - en mode dm : juste pour afficher la liste dans le header test
  const meetingParticipants: MeetingRecipient[] = row.claap_recording_id
    ? await resolveMeetingParticipantRecipients(
        row.claap_recording_id,
        row.recorder_email,
      ).catch((e) => {
        console.warn(`[sales-coach/slack/${analysisId}] participant resolution failed:`, e);
        return [] as MeetingRecipient[];
      })
    : [];

  // Cibles prod = participants Coachello internes du meeting uniquement.
  // L'owner HubSpot du deal n'est plus ajouté : si la personne n'était pas
  // dans le call, elle ne reçoit pas le debrief.
  const prodRecipients = dedupeRecipients([...meetingParticipants]);

  let recipients: MeetingRecipient[];
  let isFallback = false;

  if (mode === "test") {
    const arthur = await findArthurFallbackRecipient();
    if (!arthur) {
      return { ok: false, error: `Slack user "${process.env.CLAAP_NOTE_SLACK_TEST_USER ?? "Arthur Czernichow"}" not found (mode=test)` };
    }
    recipients = [arthur];
  } else if (prodRecipients.length > 0) {
    recipients = prodRecipients;
  } else {
    const arthur = await findArthurFallbackRecipient();
    if (!arthur) {
      return { ok: false, error: "No Coachello participants in meeting and fallback user not found" };
    }
    recipients = [arthur];
    isFallback = true;
    console.warn(`[sales-coach/slack/${analysisId}] no Coachello participant detected, falling back to Arthur`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const snapshot = row.deal_snapshot as DealSnapshot | null;
  const dealName = snapshot?.name || (row.hubspot_deal_id ? `Deal ${row.hubspot_deal_id}` : "");
  const dealStage = snapshot?.stage_label ?? null;

  const rawAnalysis = repairAnalysis(row.analysis as AnySalesCoachAnalysis);
  const resolvedAudience: Audience = audience ?? "prospect";
  // Même langue que celle imposée à la génération (recalculée sur le
  // transcript) ; repli sur le contenu pour les lignes sans transcript stocké.
  const lang = detectOutputLang(
    (row.transcript_text as string | null) ||
      [
        rawAnalysis.summary ?? "",
        ...extractStringArray(rawAnalysis.strengths),
        ...extractStringArray(rawAnalysis.weaknesses),
        ...extractStringArray(rawAnalysis.coaching_priorities),
      ].join(" "),
  );
  const body = formatAnalysisDebrief({
    audience: resolvedAudience,
    lang,
    dealName,
    dealStage,
    meetingTitle: row.meeting_title ?? "Meeting",
    meetingStartedAt: row.meeting_started_at,
    meetingKind: row.meeting_kind as MeetingKind | ClientMeetingKind | null,
    scoreGlobal: Number(row.score_global ?? 0),
    analysis: rawAnalysis,
    appUrl,
    analysisId: row.id,
    salesName: null,
  });

  // Header test : uniquement en mode test. En mode prod, on envoie le DM
  // directement aux concernés, pas besoin d'expliquer.
  const text = mode === "test"
    ? `${formatTestModeHeader({
        theoreticalRecipientEmails: isFallback ? [] : prodRecipients.map((r) => r.email),
        audience,
        kind: "coaching",
      })}\n\n${body}`
    : body;

  let sentCount = 0;
  const failures: string[] = [];
  for (const r of recipients) {
    try {
      await dmRecipient(r.memberId, text);
      sentCount++;
      console.log(`[sales-coach/slack/${analysisId}] coaching sent to ${r.email} (${r.memberId})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${r.email}: ${msg}`);
      console.warn(`[sales-coach/slack/${analysisId}] coaching send failed for ${r.email}:`, msg);
    }
  }

  if (sentCount === 0) {
    return { ok: false, error: `All recipients failed: ${failures.join("; ")}` };
  }

  await db
    .from("sales_coach_analyses")
    .update({
      slack_sent_at: new Date().toISOString(),
      slack_sent_recipients: recipients.map((r) => r.email),
    })
    .eq("id", analysisId);

  return { ok: true };
}
