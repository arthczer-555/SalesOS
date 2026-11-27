// Rattache une carte aux enregistrements Claap récents de ses contacts qui
// n'en avaient pas (meeting enregistré avant que la carte existe : annonce
// tardive dans #1y-new-meetings). Même effet qu'un rattachement manuel dans le
// Sales Coach : analyse relancée si elle attendait une carte, sinon score et
// passage en Scoping par le parcours habituel (lib/sales-coach/card-flow.ts).

import { db } from "@/lib/db";
import { getClaapRecording, pickTranscriptUrl } from "@/lib/claap";
import { DEFAULT_SCORE_MODEL, scoreOneDeal } from "@/lib/deal-scoring";
import { fetchDealContext } from "@/lib/hubspot";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { runCardFlowAfterAnalysis } from "./card-flow";
import { isTestRecording } from "./deal-match";
import { sendSalesCoachSlack } from "./slack";
import { triggerSalesCoachAnalysis } from "./trigger-analysis";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Row = {
  id: string;
  claap_recording_id: string;
  participants: { email?: string | null }[] | null;
  status: string;
  slack_sent_at: string | null;
  user_id: string | null;
  audience: string | null;
};

export async function attachDealToRecentRecordings(opts: {
  dealId: string;
  emails: string[];
  /** Mode test : seuls les rejeux de test (rec_test_) sont rattachés ; jamais en vrai. */
  testMode: boolean;
  detail: Record<string, unknown>;
  /** Origine du site, pour relancer l'analyse (fonction de fond). */
  siteOrigin: string | null;
}): Promise<{ attached: string[]; errors: string[] }> {
  const emails = new Set(opts.emails.map((e) => e.toLowerCase()).filter(Boolean));
  const errors: string[] = [];
  const attached: string[] = [];
  if (!emails.size) return { attached, errors };
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select("id, claap_recording_id, participants, status, slack_sent_at, user_id, audience")
    .is("hubspot_deal_id", null)
    .gte("created_at", since)
    .limit(200);
  if (error) return { attached, errors: [error.message] };
  const rows = ((data ?? []) as Row[])
    .filter((r) => (opts.testMode ? isTestRecording(r.claap_recording_id) : !isTestRecording(r.claap_recording_id)))
    .filter((r) => (r.participants ?? []).some((p) => !!p?.email && emails.has(p.email.toLowerCase())));

  for (const r of rows) {
    try {
      const snapshot = await fetchDealContext(opts.dealId).catch(() => null);
      const wasAwaiting = r.status === "awaiting_manual_deal";
      const { error: upErr } = await db
        .from("sales_coach_analyses")
        .update({
          hubspot_deal_id: opts.dealId,
          deal_snapshot: snapshot,
          meeting_type: "external",
          deal_match_method: "meeting_announcement",
          deal_match_detail: opts.detail,
          updated_at: new Date().toISOString(),
          ...(wasAwaiting ? { status: "pending", error_message: null } : {}),
        })
        .eq("id", r.id)
        .is("hubspot_deal_id", null);
      if (upErr) throw new Error(upErr.message);
      attached.push(r.id);

      if (wasAwaiting) {
        // L'analyse n'a jamais tourné faute de carte : on la lance (elle fera le parcours de la carte).
        if (!opts.siteOrigin || !process.env.CLAAP_API_TOKEN) continue;
        const rec = await getClaapRecording(r.claap_recording_id).catch(() => null);
        const transcriptUrl = rec ? pickTranscriptUrl(rec) : null;
        if (transcriptUrl) await triggerSalesCoachAnalysis({ origin: opts.siteOrigin, id: r.id, transcriptUrl, logTag: "meeting-attach" });
        else errors.push(`${r.id}: no transcript URL, analysis not started`);
      } else if (r.status === "done") {
        // Analyse déjà faite : score du deal, passage en Scoping si sûr, puis le debrief s'il n'est pas parti.
        if (r.audience === "prospect") {
          const model = await getModelPreference("deals_score", DEFAULT_SCORE_MODEL);
          const fresh = await scoreOneDeal(opts.dealId, r.user_id, model).catch(() => null);
          await runCardFlowAfterAnalysis(r.id, fresh);
        }
        if (!r.slack_sent_at) await sendSalesCoachSlack(db, r.id).catch(() => null);
      }
    } catch (e) {
      errors.push(`${r.id}: ${errMsg(e)}`);
    }
  }
  return { attached, errors };
}
