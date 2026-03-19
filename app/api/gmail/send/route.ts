import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken, buildRawEmail } from "@/lib/gmail";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const to = (formData.get("to") as string ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const cc = (formData.get("cc") as string ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bcc = (formData.get("bcc") as string ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const subject = (formData.get("subject") as string) ?? "";
  const body = (formData.get("body") as string) ?? "";
  const files = formData.getAll("attachments") as File[];

  if (!to.length) return NextResponse.json({ error: "Destinataire requis" }, { status: 400 });

  const attachments = await Promise.all(
    files.filter((f) => f.size > 0).map(async (f) => ({
      name: f.name,
      type: f.type || "application/octet-stream",
      data: Buffer.from(await f.arrayBuffer()),
    }))
  );

  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(user.id);
  } catch {
    return NextResponse.json({ error: "Gmail non connecté" }, { status: 403 });
  }

  // Get sender address from Gmail profile
  const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { emailAddress } = await profileRes.json();

  const raw = buildRawEmail({ from: emailAddress, to, cc, bcc, subject, body, attachments });

  const sendRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.json();
    return NextResponse.json({ error: err.error?.message ?? "Échec de l'envoi" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
