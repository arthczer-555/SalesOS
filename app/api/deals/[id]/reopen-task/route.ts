import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { stripEmDashes } from "@/lib/no-em-dash";
import { isCurrentLossAnalysis, type LossAnalysis } from "@/lib/deals/loss-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Association HubSpot task -> deal (HUBSPOT_DEFINED).
const TASK_TO_DEAL = 216;

// Crée dans HubSpot la tâche de relance proposée par l'analyse de perte
// (date, pourquoi, qui, comment, signal à surveiller), assignée à l'owner du
// deal et rattachée au deal. Au clic uniquement ; idempotent : une seule tâche
// par analyse.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await ctx.params;

  const { data: row, error } = await db
    .from("deal_loss_analyses")
    .select("analysis, reopen_task_id, reopen_task_created_at")
    .eq("deal_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (row?.reopen_task_id) {
    return NextResponse.json({ ok: true, taskId: row.reopen_task_id, createdAt: row.reopen_task_created_at, existing: true });
  }

  const analysis = row?.analysis as LossAnalysis | null;
  const reopen = isCurrentLossAnalysis(analysis) ? analysis?.reopen : null;
  if (!reopen?.date) {
    return NextResponse.json({ error: "The loss analysis has no reopen date. Reanalyze the loss first." }, { status: 400 });
  }
  if (reopen.date < new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: `The reopen date (${reopen.date}) is in the past. Reanalyze the loss first.` }, { status: 400 });
  }

  try {
    const deal = await hubspotFetch<{ properties?: { dealname?: string; hubspot_owner_id?: string } }>(
      `/crm/v3/objects/deals/${id}?properties=dealname,hubspot_owner_id`,
    );
    const p = deal.properties ?? {};
    const body = [
      reopen.timing ? `Why then: ${reopen.timing}` : null,
      reopen.who ? `Who: ${reopen.who}` : null,
      reopen.how ? `How: ${reopen.how}` : null,
      reopen.watchFor ? `Watch for: ${reopen.watchFor}` : null,
      "Created from the loss analysis in CoachelloHQ.",
    ].filter(Boolean).join("\n");
    const task = await hubspotFetch<{ id: string }>("/crm/v3/objects/tasks", "POST", {
      properties: {
        // 10h heure de Paris : la tâche tombe en début de journée.
        hs_timestamp: `${reopen.date}T08:00:00.000Z`,
        hs_task_subject: stripEmDashes(`Reopen ${p.dealname ?? "deal"}`),
        hs_task_body: stripEmDashes(body),
        hs_task_status: "NOT_STARTED",
        hs_task_priority: "MEDIUM",
        hs_task_type: "TODO",
        ...(p.hubspot_owner_id ? { hubspot_owner_id: p.hubspot_owner_id } : {}),
      },
      associations: [
        { to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: TASK_TO_DEAL }] },
      ],
    });

    const createdAt = new Date().toISOString();
    await db
      .from("deal_loss_analyses")
      .update({ reopen_task_id: task.id, reopen_task_created_at: createdAt })
      .eq("deal_id", id);
    return NextResponse.json({ ok: true, taskId: task.id, createdAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 500 });
  }
}
