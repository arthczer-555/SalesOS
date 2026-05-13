import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchDealContext } from "@/lib/hubspot";
import { sendSalesCoachSlack } from "@/lib/sales-coach/slack";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await db
    .from("sales_coach_analyses")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ analysis: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { hubspotDealId?: string | null };

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, status, hubspot_deal_id, slack_sent_at")
    .eq("id", id)
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let newDealId: string | null = null;
  if ("hubspotDealId" in body) {
    newDealId = body.hubspotDealId?.trim() || null;
    update.hubspot_deal_id = newDealId;
    if (newDealId) {
      const snapshot = await fetchDealContext(newDealId).catch(() => null);
      if (snapshot) update.deal_snapshot = snapshot;
    }
  }

  const { error } = await db.from("sales_coach_analyses").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire the Slack digest if this attribution is what was blocking it:
  // - a deal id was just set (newly or replacing null)
  // - the analysis is complete
  // - the digest hasn't been sent yet
  // - Slack is globally enabled
  const shouldSendSlack =
    !!newDealId &&
    !row.hubspot_deal_id &&
    row.status === "done" &&
    !row.slack_sent_at &&
    process.env.SALES_COACH_SLACK_ENABLED === "true";
  if (shouldSendSlack) {
    const slackRes = await sendSalesCoachSlack(db, id).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!slackRes.ok) {
      console.warn(`[sales-coach/${id}] Slack send after manual deal attribution failed:`, slackRes.error);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await db.from("sales_coach_analyses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
