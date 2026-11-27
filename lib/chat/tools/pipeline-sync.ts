/**
 * get_pipeline_sync : la bascule HubSpot du 30/11 vue par CoachelloHQ (plan :
 * __documentation/hubspot-pipeline-switch-plan.md). Ce que CoachelloHQ a écrit
 * dans HubSpot (journal hubspot_write_log : cartes créées à la validation d'un
 * lead, passages R1 scheduled -> Scoping (SQL) après un R1 tenu, scores écrits
 * dans score_medic_kuna), les demandes de confirmation (✅ / ❌ sur le DM Slack
 * ou bouton du Sales Coach) et les réglages de la bascule. Mêmes tables que les
 * écrans et le script de test : aucun recalcul.
 *
 * Accès (règle commune de lib/chat/tools/viewer.ts) : un admin voit tout ; un
 * non-admin ne voit que les cartes dont il est owner et les demandes qui lui
 * sont adressées. Cartes "TEST - ..." exclues sauf include_tests. Source
 * agents : "hubspot".
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { CUTOVER_DATE, loadCutoverState } from "@/lib/hubspot/cutover";
import { getStageLabels, isTestDealName } from "@/lib/hubspot/pipeline-model";
import { listWrites, type WriteLogRow } from "@/lib/hubspot/write-log";
import type { ToolModule } from "./types";
import { viewer } from "./viewer";

const ACTION_LABELS: Record<string, string> = {
  create_deal: "card created in Prospection / R1 scheduled",
  r1_to_scoping: "card moved from R1 scheduled to Scoping (SQL) after the R1",
  score: "qualification score written to HubSpot (score_medic_kuna)",
  type_offre: "offer written to HubSpot (type_offre)",
  loss_category: "loss category written to HubSpot",
  reactivation: "reactivation written to HubSpot",
  contact_unqualified: "contact marked unqualified",
  create_contact: "contact created",
  create_company: "company created",
  archive_deal: "test card archived",
  create_task: "call task created for the owner (lead validated, no card)",
  update_task: "call task reassigned to another owner",
  complete_task: "call task completed (meeting booked)",
};

const TRIGGER_LABELS: Record<string, string> = {
  lead_validation: "lead validation in the Lead Manager",
  claap_call: "Claap meeting analyzed, sure match",
  confirmation: "confirmed by a person who attended the meeting",
  manual: "manual action in CoachelloHQ",
  test_script: "test script",
  meeting_announcement: "meeting announced in #1y-new-meetings, confirmed with a check mark",
};

const defs: Anthropic.Tool[] = [
  {
    name: "get_pipeline_sync",
    description:
      "Bascule HubSpot du 30/11 (deux pipelines de cartes : Prospection = les leads, R1 scheduled > Scoping (SQL) > Opportunity low / medium / high ; puis Sales = les deals, Qualified opportunity et au-delà) vue par CoachelloHQ : (1) ce que CoachelloHQ a écrit dans HubSpot, carte par carte : carte créée en R1 scheduled à la validation d'un lead, passage R1 scheduled > Scoping (SQL) après un R1 enregistré sur Claap, score de qualification écrit (le workflow HubSpot de Gaëlle range ensuite la carte : moins de 40 low, 40-59 medium, 60-79 high, 80 et plus pipeline Sales), avec la date, le déclencheur (meeting sûr, confirmation humaine, validation de lead) et le résultat (done / failed) ; (2) les demandes de confirmation : meeting Claap dont le rattachement à une carte n'est pas sûr, envoyé en DM aux Coachello présents (réponse par ✅ / ❌ ou bouton dans le Sales Coach), en attente ou répondues ; (3) les réglages de la bascule (création des cartes, passage en Scoping, écriture du score : off, test = cartes 'TEST - ...' seulement, on). Source : tables CoachelloHQ (journal des écritures, demandes Slack, réglages), PAS HubSpot : pour l'étape actuelle d'une carte et son score dans HubSpot, le champ deal.stage_now est relu en direct, sinon utilise get_deals. Ne couvre pas les déplacements faits à la main par les commerciaux ni ceux du workflow HubSpot (low / medium / high). Un non-admin ne voit que ses cartes et ses demandes.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "ID HubSpot d'une carte pour ne voir qu'elle (optionnel)." },
        days: { type: "number", description: "Fenêtre en jours (défaut 14, max 90)." },
        include_tests: { type: "boolean", description: "Inclure les cartes de test 'TEST - ...' (défaut false)." },
      },
      required: [],
    },
  },
];

interface ConfirmationLite {
  kind: string;
  request_key: string;
  deal_id: string | null;
  analysis_id: string | null;
  slack_user_id: string | null;
  mode: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  proposed: Record<string, unknown> | null;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
}

type DealLite = { name: string | null; ownerId: string | null; pipeline: string | null; stage: string | null; hubspotScore: number | null };

async function readDeals(ids: string[]): Promise<Map<string, DealLite>> {
  const out = new Map<string, DealLite>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await hubspotFetch<{ results?: { id: string; properties: Record<string, string | null> }[] }>("/crm/v3/objects/deals/batch/read", "POST", {
      inputs: chunk.map((id) => ({ id })),
      properties: ["dealname", "hubspot_owner_id", "pipeline", "dealstage", "score_medic_kuna"],
    });
    for (const d of res.results ?? []) {
      const p = d.properties;
      out.set(d.id, {
        name: p.dealname ?? null,
        ownerId: p.hubspot_owner_id ?? null,
        pipeline: p.pipeline ?? null,
        stage: p.dealstage ?? null,
        hubspotScore: p.score_medic_kuna ? Number(p.score_medic_kuna) : null,
      });
    }
  }
  return out;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const handlers: ToolModule["handlers"] = {
  get_pipeline_sync: async (input, ctx) => {
    ctx.onProgress("Reading CoachelloHQ writes to HubSpot...");
    const v = await viewer(ctx);
    const dealFilter = typeof input.deal_id === "string" && input.deal_id.trim() ? input.deal_id.trim() : null;
    const days = Math.min(90, Math.max(1, Math.round(Number(input.days) || 14)));
    const includeTests = input.include_tests === true;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const errors: string[] = [];

    let settings: Awaited<ReturnType<typeof loadCutoverState>> | null = null;
    try {
      settings = await loadCutoverState();
    } catch (e) {
      errors.push(`settings unreadable: ${errMsg(e)}`);
    }

    let writes: WriteLogRow[] = [];
    try {
      writes = (await listWrites({ objectId: dealFilter ?? undefined, sinceIso: since, limit: 300 })).filter((w) => w.object_type === "deals" && w.object_id);
    } catch (e) {
      errors.push(`write log unreadable: ${errMsg(e)}`);
    }

    let confirmations: ConfirmationLite[] = [];
    {
      let q = db
        .from("slack_confirmations")
        .select("kind, request_key, deal_id, analysis_id, slack_user_id, mode, status, created_at, expires_at, proposed, answer, answered_by, answered_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300);
      if (dealFilter) q = q.eq("deal_id", dealFilter);
      const { data, error } = await q;
      if (error) errors.push(`confirmations unreadable: ${error.message}`);
      confirmations = (data ?? []) as ConfirmationLite[];
    }

    const dealIds = [...new Set([...writes.map((w) => w.object_id as string), ...confirmations.map((c) => c.deal_id).filter((x): x is string => !!x)])];
    let deals = new Map<string, DealLite>();
    try {
      deals = await readDeals(dealIds);
    } catch (e) {
      errors.push(`HubSpot unreadable (card names and current stages missing): ${errMsg(e)}`);
    }

    // Cartes de test exclues par défaut (journal : is_test ; demandes : nom de la carte).
    if (!includeTests) {
      writes = writes.filter((w) => !w.is_test);
      confirmations = confirmations.filter((c) => !isTestDealName(deals.get(c.deal_id ?? "")?.name ?? (c.proposed?.dealName as string | undefined) ?? ""));
    }

    // Règle d'accès : un non-admin ne voit que ses cartes et les demandes qui lui sont adressées.
    if (!v.isAdmin) {
      const { data: me } = await db.from("users").select("slack_user_id").eq("id", ctx.userId).maybeSingle();
      const mySlack = (me?.slack_user_id as string | null) ?? null;
      const myOwner = ctx.userOwnerId;
      const mine = (dealId: string | null) => !!myOwner && !!dealId && deals.get(dealId)?.ownerId === myOwner;
      writes = writes.filter((w) => mine(w.object_id));
      confirmations = confirmations.filter((c) => (mySlack && c.slack_user_id === mySlack) || mine(c.deal_id));
    }

    const { stages, pipelines } = await getStageLabels().catch(() => ({ stages: {} as Record<string, string>, pipelines: {} as Record<string, string> }));
    const dealView = (id: string | null, fallbackName?: string | null) => {
      if (!id) return null;
      const d = deals.get(id);
      return {
        id,
        name: d?.name ?? fallbackName ?? null,
        stage_now: d ? `${pipelines[d.pipeline ?? ""] ?? d.pipeline} / ${stages[d.stage ?? ""] ?? d.stage}` : null,
        hubspot_score_now: d?.hubspotScore ?? null,
      };
    };

    // Une demande = un ou plusieurs messages (un par destinataire) : regroupés par request_key.
    const byRequest = new Map<string, ConfirmationLite[]>();
    for (const c of confirmations) byRequest.set(c.request_key, [...(byRequest.get(c.request_key) ?? []), c]);
    const analysisIds = [...new Set(confirmations.map((c) => c.analysis_id).filter((x): x is string => !!x))];
    const meetings = new Map<string, { title: string | null; started_at: string | null }>();
    if (analysisIds.length) {
      const { data } = await db.from("sales_coach_analyses").select("id, meeting_title, meeting_started_at").in("id", analysisIds);
      for (const m of (data ?? []) as { id: string; meeting_title: string | null; meeting_started_at: string | null }[]) meetings.set(m.id, { title: m.meeting_title, started_at: m.meeting_started_at });
    }
    const requests = [...byRequest.values()].map((rows) => {
      const first = rows[0];
      const answered = rows.find((r) => r.answer);
      const now = Date.now();
      const status = rows.some((r) => r.status === "pending" && (!r.expires_at || Date.parse(r.expires_at) > now))
        ? "pending"
        : answered
          ? `answered_${answered.answer}`
          : rows.some((r) => r.status === "pending")
            ? "expired"
            : first.status;
      const meeting = first.analysis_id ? meetings.get(first.analysis_id) : undefined;
      return {
        question: first.kind === "r1_move" ? "Was this meeting the R1 of this card? (yes = move to Scoping and write the score)" : "Is this meeting about this card? (yes = write the score)",
        status,
        mode: first.mode,
        card: dealView(first.deal_id, (first.proposed?.dealName as string | undefined) ?? null),
        meeting: meeting ? { title: meeting.title, date: meeting.started_at, analysis_id: first.analysis_id } : null,
        proposed_score: typeof first.proposed?.score === "number" ? first.proposed.score : null,
        asked_at: first.created_at,
        expires_at: first.expires_at,
        recipients: rows.length,
        answered_by: answered?.answered_by ?? null,
        answered_at: answered?.answered_at ?? null,
      };
    });

    return JSON.stringify({
      source: "CoachelloHQ (journal hubspot_write_log, demandes slack_confirmations, réglages guide_defaults.hubspot_cutover), pas HubSpot",
      period: { days, since },
      scope: v.isAdmin ? "all cards (admin)" : "your cards and the requests sent to you",
      settings: settings
        ? {
            cutover_date: CUTOVER_DATE,
            cutover_instant: settings.cutoverAt,
            card_creation: settings.values.hubspot_creation,
            r1_to_scoping_automatic: settings.values.hubspot_r1_move,
            r1_to_scoping_after_confirmation: settings.values.r1_confirm_move,
            score_write: settings.values.hubspot_score_write,
            slack_reaction_confirmation: settings.values.slack_confirm_reaction,
            legend: "off = nothing written; test = only cards named 'TEST - ...'; on_new = cards created after the cutover or moved to Scoping by CoachelloHQ; on = all eligible cards",
          }
        : null,
      pending_confirmations: requests.filter((r) => r.status === "pending").slice(0, 30),
      answered_or_expired_confirmations: requests.filter((r) => r.status !== "pending").slice(0, 20),
      writes: writes.slice(0, 60).map((w) => ({
        at: w.created_at,
        action: ACTION_LABELS[w.action] ?? w.action,
        card: dealView(w.object_id),
        trigger: TRIGGER_LABELS[w.triggered_by] ?? w.triggered_by,
        status: w.status,
        mode: w.mode,
        test: w.is_test,
        before: w.before_value,
        after: w.after_value,
        error: w.error,
      })),
      truncated: { writes: Math.max(0, writes.length - 60) },
      errors,
    });
  },
};

export const pipelineSyncTools: ToolModule = { defs, handlers };
