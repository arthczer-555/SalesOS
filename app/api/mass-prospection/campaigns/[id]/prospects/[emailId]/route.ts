import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH — update email content after manual edit
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; emailId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id, emailId } = await params;

  // Verify campaign ownership
  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("subject" in body) updates.subject = body.subject;
  if ("body" in body) updates.body = body.body;
  if (updates.subject !== undefined || updates.body !== undefined) {
    updates.status = "edited";
  }

  const { error } = await db
    .from("mass_campaign_emails")
    .update(updates)
    .eq("id", emailId)
    .eq("campaign_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE — remove a prospect from campaign
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; emailId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id, emailId } = await params;

  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });

  const { error } = await db
    .from("mass_campaign_emails")
    .delete()
    .eq("id", emailId)
    .eq("campaign_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
