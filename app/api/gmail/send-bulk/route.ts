import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken, buildRawEmail } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { recipients, subject, body } = await req.json() as {
    recipients: { email: string; firstName: string }[];
    subject: string;
    body: string;
  };

  if (!recipients?.length) return NextResponse.json({ error: "Aucun destinataire" }, { status: 400 });
  if (recipients.length > 100) return NextResponse.json({ error: "Maximum 100 destinataires" }, { status: 400 });

  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(user.id);
  } catch {
    return NextResponse.json({ error: "Gmail non connecté" }, { status: 403 });
  }

  const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { emailAddress } = await profileRes.json();

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    if (!recipient.email) {
      failed++;
      errors.push(`Contact sans email ignoré`);
      continue;
    }

    const greeting = recipient.firstName?.trim() ? `Bonjour ${recipient.firstName},` : "Bonjour,";
    const personalizedBody = `${greeting}\n\n${body}`;

    const raw = buildRawEmail({
      from: emailAddress,
      to: [recipient.email],
      cc: [],
      bcc: [],
      subject,
      body: personalizedBody,
    });

    try {
      const sendRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });

      if (sendRes.ok) {
        sent++;
      } else {
        const err = await sendRes.json();
        failed++;
        errors.push(`${recipient.email}: ${err.error?.message ?? "Échec"}`);
      }
    } catch (e) {
      failed++;
      errors.push(`${recipient.email}: ${e instanceof Error ? e.message : "Erreur réseau"}`);
    }

    // 300ms delay between sends to respect Gmail rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({ sent, failed, errors });
}
