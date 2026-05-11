import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;

  const { data: intel } = await db
    .from("market_signals")
    .select("title, summary, suggested_action, source_url, company_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!intel) return NextResponse.json({ error: "Intel introuvable" }, { status: 404 });

  const { data: userRow } = await db
    .from("users")
    .select("hubspot_owner_id")
    .eq("id", user.id)
    .single();

  const ownerId = userRow?.hubspot_owner_id;

  const body = [
    `[Intel] ${intel.title}`,
    intel.suggested_action ? `\nAction : ${intel.suggested_action}` : "",
    intel.summary ? `\n${intel.summary}` : "",
    intel.source_url ? `\nSource : ${intel.source_url}` : "",
  ].filter(Boolean).join("");

  try {
    const dueDate = Date.now() + 24 * 60 * 60 * 1000; // demain
    const properties: Record<string, string> = {
      hs_task_subject: intel.title.slice(0, 200),
      hs_task_body: body.slice(0, 5000),
      hs_task_priority: "MEDIUM",
      hs_task_status: "NOT_STARTED",
      hs_task_type: "TODO",
      hs_timestamp: String(dueDate),
    };
    if (ownerId) properties.hubspot_owner_id = ownerId;

    const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/tasks", "POST", { properties });

    // Mark intel as actioned
    await db.from("market_signals").update({ is_actioned: true }).eq("id", id).eq("user_id", user.id);

    return NextResponse.json({ ok: true, taskId: created.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur HubSpot" }, { status: 500 });
  }
}
