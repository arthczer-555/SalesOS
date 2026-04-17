import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ProspectInput {
  hubspot_id?: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  company?: string;
  industry?: string;
  extraData?: Record<string, unknown>;
}

// POST — add prospects to campaign (bulk, deduplicates by email)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  // Verify campaign ownership
  const { data: campaign } = await db
    .from("mass_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });

  const { prospects } = (await req.json()) as { prospects: ProspectInput[] };
  if (!prospects?.length) return NextResponse.json({ error: "Aucun prospect fourni" }, { status: 400 });

  // Get existing emails in this campaign for dedup
  const { data: existing } = await db
    .from("mass_campaign_emails")
    .select("email")
    .eq("campaign_id", id);
  const existingEmails = new Set((existing ?? []).map((e: { email: string }) => e.email.toLowerCase()));

  const toInsert = prospects
    .filter((p) => p.email && !existingEmails.has(p.email.toLowerCase()))
    .map((p) => ({
      campaign_id: id,
      hubspot_id: p.hubspot_id || null,
      first_name: p.firstName || "",
      last_name: p.lastName || "",
      email: p.email,
      job_title: p.jobTitle || "",
      company: p.company || "",
      industry: p.industry || "",
      extra_data: p.extraData || {},
      status: "pending",
    }));

  const skipped = prospects.length - toInsert.length;

  if (toInsert.length > 0) {
    const { error } = await db.from("mass_campaign_emails").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ added: toInsert.length, skipped });
}
