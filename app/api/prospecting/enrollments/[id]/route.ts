import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCampaign, listSteps } from "@/lib/prospecting/store/campaigns";
import { getContact } from "@/lib/prospecting/store/contacts";
import { applyEnrollmentAction, ENROLLMENT_ACTIONS, type EnrollmentAction } from "@/lib/prospecting/store/enrollments";
import type { EnrollmentRow, EventRow, TouchRow } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET : détail d'un prospect dans une campagne (contact, messages, étapes, journal).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { data } = await db.from("prospecting_enrollments").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  const enrollment = data as EnrollmentRow;

  const [contact, touchesRes, steps, eventsRes, campaign] = await Promise.all([
    getContact(enrollment.contact_id),
    db.from("prospecting_touches").select("*").eq("enrollment_id", id).order("position"),
    listSteps(enrollment.campaign_id),
    db.from("prospecting_events").select("*").eq("enrollment_id", id).order("occurred_at", { ascending: false }).limit(100),
    getCampaign(enrollment.campaign_id),
  ]);
  return NextResponse.json({
    enrollment,
    contact,
    touches: (touchesRes.data ?? []) as TouchRow[],
    steps,
    events: (eventsRes.data ?? []) as EventRow[],
    campaign: campaign ? { id: campaign.id, name: campaign.name, status: campaign.status, settings: campaign.settings } : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { action?: EnrollmentAction };
  if (!body.action || !ENROLLMENT_ACTIONS.includes(body.action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const res = await applyEnrollmentAction(user.id, [id], body.action);
    if (res.updated === 0 && res.errors.length) return NextResponse.json({ error: res.errors[0] }, { status: 409 });
    const { data } = await db.from("prospecting_enrollments").select("*").eq("id", id).maybeSingle();
    return NextResponse.json({ enrollment: data, updated: res.updated, removed: !data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 500 });
  }
}
