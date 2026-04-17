import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET — list user's campaigns
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("mass_campaigns")
    .select("*, mass_campaign_emails(id, status)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaigns = (data ?? []).map((c: Record<string, unknown>) => {
    const emails = (c.mass_campaign_emails ?? []) as { id: string; status: string }[];
    return {
      ...c,
      mass_campaign_emails: undefined,
      emailCount: emails.length,
      draftedCount: emails.filter((e) => ["drafted", "edited"].includes(e.status)).length,
      sentCount: emails.filter((e) => e.status === "sent").length,
      errorCount: emails.filter((e) => e.status === "error").length,
    };
  });

  return NextResponse.json({ campaigns });
}

// POST — create a new campaign
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const { name, objective, qcm_type, qcm_length, qcm_tone, qcm_objectif } = body;

  const { data, error } = await db
    .from("mass_campaigns")
    .insert({
      user_id: user.id,
      name: name || null,
      objective: objective || "",
      status: "draft",
      qcm_type: qcm_type || null,
      qcm_length: qcm_length || null,
      qcm_tone: qcm_tone || null,
      qcm_objectif: qcm_objectif || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campaign: data });
}
