import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";
import { sendSalesCoachSlack } from "./slack";
import { fetchDealContext, renderDealContextForPrompt, resolveDealFromParticipants } from "../hubspot";
import { getClaapRecording, fetchTranscriptSegments, pickTranscriptJsonUrl } from "../claap";
import { computeTalkRatio } from "./talk-ratio";
import {
  SALES_COACH_SYSTEM_PROMPT,
  salesCoachTool,
  computeGlobalScore,
  repairAnalysis,
  type SalesCoachAnalysis,
} from "../guides/sales-coach";
import {
  generateMeetingRecap,
  resolveAudience,
  sendMeetingRecapSlack,
  type Audience,
  type MeetingRecap,
} from "./meeting-recap";
import { scoreOneDeal } from "@/app/api/deals/score/route";

const DEFAULT_ANALYZE_MODEL = "claude-haiku-4-5-20251001";
const MAX_TRANSCRIPT_CHARS_FOR_CLAUDE = 150_000;

type PriorAnalysisRow = {
  id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  score_global: number | null;
  meeting_kind: string | null;
  analysis: { summary?: string; bosche?: { trigger_identified?: string | null } } | null;
};

function renderPriorAnalyses(rows: PriorAnalysisRow[]): string {
  if (rows.length === 0) return "Aucun meeting Claap précédent analysé sur ce deal.";
  const lines = [`## Historique Sales Coach sur ce deal (${rows.length})`];
  for (const r of rows) {
    const date = r.meeting_started_at ? new Date(r.meeting_started_at).toLocaleDateString("fr-FR") : "?";
    const score = r.score_global != null ? `${r.score_global}/10` : "?";
    const kind = r.meeting_kind ?? "?";
    const trigger = r.analysis?.bosche?.trigger_identified;
    const summary = r.analysis?.summary?.slice(0, 200) ?? "";
    lines.push(`- [${date}] ${r.meeting_title ?? "?"} (${kind}, ${score}${trigger ? `, trigger: ${trigger}` : ""})`);
    if (summary) lines.push(`  Résumé : ${summary}`);
  }
  return lines.join("\n");
}

export type RunAnalysisResult =
  | { ok: true; already: "done" | "analyzing" }
  | { ok: true; scoreGlobal: number | null }
  | { ok: false; status: number; error: string };

export async function runSalesCoachAnalysis(id: string, transcriptUrl: string): Promise<RunAnalysisResult> {
  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("id, status, updated_at, user_id, meeting_title, meeting_started_at, hubspot_deal_id, claap_recording_id, recorder_email")
    .eq("id", id)
    .single();

  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (row.status === "done") return { ok: true, already: "done" };
  if (row.status === "analyzing") {
    const ageMin = row.updated_at
      ? (Date.now() - new Date(row.updated_at).getTime()) / 60_000
      : Infinity;
    if (ageMin < 5) return { ok: true, already: "analyzing" };
  }

  await db
    .from("sales_coach_analyses")
    .update({ status: "analyzing", updated_at: new Date().toISOString() })
    .eq("id", id);

  try {
    if (!transcriptUrl) throw new Error("transcriptUrl missing");

    const txtRes = await fetch(transcriptUrl);
    if (!txtRes.ok) throw new Error(`Transcript fetch failed: ${txtRes.status}`);
    const rawText = await txtRes.text();
    if (!rawText.trim()) throw new Error("Empty transcript");

    const transcriptForClaude = rawText.length > MAX_TRANSCRIPT_CHARS_FOR_CLAUDE
      ? rawText.slice(0, MAX_TRANSCRIPT_CHARS_FOR_CLAUDE)
      : rawText;

    let analyzeModel = DEFAULT_ANALYZE_MODEL;
    let recapModel: string | undefined;
    const { data: globalModelEntry } = await db
      .from("guide_defaults")
      .select("content")
      .eq("key", "model_preferences")
      .single();
    try {
      if (globalModelEntry?.content) {
        const prefs = JSON.parse(globalModelEntry.content) as Record<string, string>;
        analyzeModel = prefs.sales_coach ?? analyzeModel;
        recapModel = prefs.meeting_recap;
      }
    } catch { /* keep defaults */ }

    let dealId = row.hubspot_deal_id as string | null;
    let talkRatio: ReturnType<typeof computeTalkRatio> | null = null;

    if (row.claap_recording_id && process.env.CLAAP_API_TOKEN) {
      try {
        const rec = await getClaapRecording(row.claap_recording_id);
        const participants = rec?.meeting?.participants ?? [];

        if (!dealId && row.recorder_email) {
          const participantEmails = participants
            .map((p) => p.email)
            .filter((e): e is string => !!e);
          const resolved = await resolveDealFromParticipants(participantEmails, row.recorder_email).catch((e) => {
            console.warn(`[sales-coach/analyze/${id}] deal auto-resolve failed:`, e instanceof Error ? e.message : e);
            return null;
          });
          if (resolved) {
            dealId = resolved;
            await db.from("sales_coach_analyses").update({ hubspot_deal_id: resolved }).eq("id", id);
            console.log(`[sales-coach/analyze/${id}] auto-resolved deal ${resolved} from participants`);
          }
        }

        const jsonUrl = rec ? pickTranscriptJsonUrl(rec) : null;
        if (jsonUrl) {
          const structured = await fetchTranscriptSegments(jsonUrl);
          if (structured) {
            const enrichedSpeakers = structured.speakers.map((sp) => {
              if (sp.email) return sp;
              const match = participants.find((p) => p.name && sp.name && p.name === sp.name);
              return match ? { ...sp, email: match.email, isRecorder: match.email === rec?.recorder?.email } : sp;
            });
            talkRatio = computeTalkRatio({
              segments: structured.segments,
              speakers: enrichedSpeakers,
              recorderEmail: row.recorder_email,
            });
          }
        }
      } catch (e) {
        console.warn(`[sales-coach/analyze/${id}] Claap enrichment failed:`, e instanceof Error ? e.message : e);
      }
    }

    const [dealSnapshot, priorAnalysesRes, dealScoreRes] = await Promise.allSettled([
      dealId ? fetchDealContext(dealId) : Promise.resolve(null),
      dealId
        ? db
            .from("sales_coach_analyses")
            .select("id, meeting_title, meeting_started_at, score_global, meeting_kind, analysis")
            .eq("hubspot_deal_id", dealId)
            .neq("id", id)
            .eq("status", "done")
            .order("meeting_started_at", { ascending: false, nullsFirst: false })
            .limit(10)
        : Promise.resolve({ data: [] as PriorAnalysisRow[] }),
      dealId
        ? db.from("deal_scores").select("score, reasoning, next_action").eq("deal_id", dealId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const snapshot = dealSnapshot.status === "fulfilled" ? dealSnapshot.value : null;
    const priorAnalyses = (priorAnalysesRes.status === "fulfilled" ? (priorAnalysesRes.value.data ?? []) : []) as PriorAnalysisRow[];
    const dealScore = dealScoreRes.status === "fulfilled"
      ? (dealScoreRes.value as { data: { score: unknown; reasoning?: string; next_action?: string } | null }).data
      : null;

    // Reattribute the row to the deal owner (= actual sales rep) instead of the
    // Claap recorder. The webhook initially sets user_id from recorder_email,
    // which can be a shared bot account or whoever scheduled the call. The
    // deal owner on HubSpot is the source of truth for "whose meeting is this"
    // — used by the "Mes meetings" filter on /sales-coach.
    if (snapshot?.owner_id) {
      const { data: ownerUser } = await db
        .from("users")
        .select("id")
        .eq("hubspot_owner_id", snapshot.owner_id)
        .maybeSingle();
      if (ownerUser?.id && ownerUser.id !== row.user_id) {
        await db.from("sales_coach_analyses").update({ user_id: ownerUser.id }).eq("id", id);
        console.log(`[sales-coach/analyze/${id}] reassigned user_id ${row.user_id ?? "null"} → ${ownerUser.id} (deal owner)`);
      }
    }

    const audience: Audience = resolveAudience(snapshot);
    console.log(`[sales-coach/analyze/${id}] audience=${audience} (dealId=${dealId ?? "none"}, closed_won=${snapshot?.is_closed_won === true}, pipeline=${snapshot?.pipeline_label ?? "?"})`);

    let dealScoreSummary: { total: number | null; reasoning: string | null; next_action: string | null } | null = null;
    if (dealScore?.score) {
      const s = dealScore.score as { total?: number };
      dealScoreSummary = {
        total: s.total ?? null,
        reasoning: dealScore.reasoning ?? null,
        next_action: dealScore.next_action ?? null,
      };
    }

    let analysis: SalesCoachAnalysis | null = null;
    let scoreGlobal: number | null = null;
    let recap: MeetingRecap | null = null;

    if (audience === "prospect") {
      const scoreBlock = dealScoreSummary
        ? `\n## Score IA du deal : ${dealScoreSummary.total ?? "?"}/100${dealScoreSummary.reasoning ? `\nReasoning : ${dealScoreSummary.reasoning}` : ""}${dealScoreSummary.next_action ? `\nNext action suggérée : ${dealScoreSummary.next_action}` : ""}`
        : "";

      const coachingPrompt = [
        `## Meeting à analyser`,
        `- Titre : ${row.meeting_title ?? "?"}`,
        `- Date : ${row.meeting_started_at ?? "?"}`,
        ``,
        renderDealContextForPrompt(snapshot),
        scoreBlock,
        ``,
        renderPriorAnalyses(priorAnalyses),
        ``,
        `## Transcription`,
        transcriptForClaude,
      ].filter(Boolean).join("\n");

      // Streaming keeps the TCP connection active during generation — see
      // earlier note. Same rationale for both calls below.
      const client = new Anthropic({ timeout: 600_000 });
      const coachingStreamP = client.messages.stream({
        model: analyzeModel,
        max_tokens: 8000,
        system: SALES_COACH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: coachingPrompt }],
        tools: [salesCoachTool],
        tool_choice: { type: "tool" as const, name: "sales_coach_analysis" },
      }).finalMessage();

      // Re-score the deal so the recap reflects the just-arrived meeting.
      // Runs in parallel with the coaching analysis; the recap is chained off
      // its result so it can use the fresh score/next_action. Failures fall
      // back to the previously-fetched dealScoreSummary — never blocks the
      // pipeline.
      const scoringP: Promise<typeof dealScoreSummary> = (async () => {
        if (!dealId) return dealScoreSummary;
        try {
          const fresh = await scoreOneDeal(dealId, row.user_id);
          console.log(`[sales-coach/analyze/${id}] deal ${dealId} rescored: ${fresh.total}/100`);
          return {
            total: fresh.total,
            reasoning: fresh.reasoning,
            next_action: fresh.next_action,
          };
        } catch (e) {
          console.warn(`[sales-coach/analyze/${id}] deal rescoring failed:`, e instanceof Error ? e.message : e);
          return dealScoreSummary;
        }
      })();

      const recapP = scoringP.then((freshScore) =>
        generateMeetingRecap({
          transcript: transcriptForClaude,
          audience: "prospect",
          dealSnapshot: snapshot,
          dealScore: freshScore,
          priorAnalyses,
          meetingTitle: row.meeting_title,
          meetingStartedAt: row.meeting_started_at,
          userId: row.user_id,
          model: recapModel,
        }),
      );

      const [coachingMessage, recapResult] = await Promise.all([coachingStreamP, recapP]);

      logUsage(row.user_id, analyzeModel, coachingMessage.usage.input_tokens, coachingMessage.usage.output_tokens, "sales_coach_analyze");

      const toolBlock = coachingMessage.content.find((b) => b.type === "tool_use");
      if (!toolBlock || !("input" in toolBlock)) throw new Error("No tool_use block in coaching response");
      analysis = repairAnalysis(toolBlock.input as SalesCoachAnalysis);
      scoreGlobal = computeGlobalScore(analysis);
      recap = recapResult.recap;
    } else {
      // Client — skip coaching, only generate the meeting recap.
      const recapResult = await generateMeetingRecap({
        transcript: transcriptForClaude,
        audience: "client",
        dealSnapshot: snapshot,
        dealScore: null,
        priorAnalyses: [],
        meetingTitle: row.meeting_title,
        meetingStartedAt: row.meeting_started_at,
        userId: row.user_id,
        model: recapModel,
      });
      recap = recapResult.recap;
    }

    await db
      .from("sales_coach_analyses")
      .update({
        analysis,
        score_global: scoreGlobal,
        meeting_recap: recap,
        audience,
        transcript_text: rawText,
        deal_snapshot: snapshot,
        meeting_kind: analysis?.meeting_kind ?? null,
        talk_ratio: talkRatio,
        status: "done",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    const slackEnabled = process.env.SALES_COACH_SLACK_ENABLED === "true";

    // Sales-coach Slack (DM to owner) — prospects only, only if coaching ran.
    if (audience === "prospect" && slackEnabled && row.user_id && dealId) {
      const slackRes = await sendSalesCoachSlack(db, id).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!slackRes.ok) {
        console.warn(`[sales-coach/analyze/${id}] coaching Slack send skipped:`, slackRes.error);
      }
    } else if (audience === "prospect" && !slackEnabled) {
      console.log(`[sales-coach/analyze/${id}] coaching Slack disabled globally (SALES_COACH_SLACK_ENABLED)`);
    } else if (audience === "prospect" && !dealId) {
      console.log(`[sales-coach/analyze/${id}] coaching Slack send deferred — no deal yet`);
    }

    // Meeting recap Slack — fires for both audiences. Routing/safety handled
    // inside (defaults to DM mode via CLAAP_NOTE_SLACK_MODE).
    if (recap) {
      const recapSlackRes = await sendMeetingRecapSlack(db, id).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!recapSlackRes.ok) {
        console.warn(`[sales-coach/analyze/${id}] recap Slack send skipped:`, recapSlackRes.error);
      }
    }

    return { ok: true, scoreGlobal };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sales-coach/analyze/${id}] error:`, msg);
    await db
      .from("sales_coach_analyses")
      .update({ status: "error", error_message: msg, updated_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: false, status: 500, error: msg };
  }
}
