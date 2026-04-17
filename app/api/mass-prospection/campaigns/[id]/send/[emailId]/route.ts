import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGmailAccessToken, buildRawEmail } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; emailId: string }> }) {
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

  const { data: email } = await db
    .from("mass_campaign_emails")
    .select("*")
    .eq("id", emailId)
    .eq("campaign_id", id)
    .single();
  if (!email) return NextResponse.json({ error: "Email introuvable" }, { status: 404 });

  const { action } = (await req.json()) as { action: "send" | "draft" };

  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(user.id);
  } catch {
    return NextResponse.json({ error: "Gmail non connecté" }, { status: 403 });
  }

  // Get sender address
  const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { emailAddress } = await profileRes.json();

  const raw = buildRawEmail({
    from: emailAddress,
    to: [email.email],
    cc: [],
    bcc: [],
    subject: email.subject || "",
    body: email.body || "",
    attachments: [],
  });

  if (action === "send") {
    const sendRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!sendRes.ok) {
      const err = await sendRes.json();
      return NextResponse.json({ error: err.error?.message ?? "Échec de l'envoi" }, { status: 500 });
    }

    await db.from("mass_campaign_emails").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", emailId);
  } else {
    const draftRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!draftRes.ok) {
      const err = await draftRes.json();
      return NextResponse.json({ error: err.error?.message ?? "Échec du brouillon" }, { status: 500 });
    }

    await db.from("mass_campaign_emails").update({
      status: "draft_saved",
      updated_at: new Date().toISOString(),
    }).eq("id", emailId);
  }

  return NextResponse.json({ ok: true, action });
}
