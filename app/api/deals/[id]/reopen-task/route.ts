import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { stripEmDashes } from "@/lib/no-em-dash";
import type { LossAnalysis } from "@/lib/deals/loss-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Association HubSpot task -> deal (HUBSPOT_DEFINED).
const TASK_TO_DEAL = 216;

// Crée dans HubSpot la tâche de relance proposée par l'analyse de perte
// (date, déclencheur, chemin d'accès), assignée à l'owner du deal et rattachée
// au deal. Au clic uniquement ; idempotent : une seule tâche par analyse.
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

  const reopen = (row?.analysis as LossAnalysis | null)?.reopen;
  if (!reopen || reopen.verdict === "no" || !reopen.date) {
    return NextResponse.json({ error: "The loss analysis does not recommend a reopen date" }, { status: 400 });
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
      reopen.trigger ? `Trigger: ${reopen.trigger}` : null,
      reopen.wayIn ? `Way in: ${reopen.wayIn}` : null,
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
