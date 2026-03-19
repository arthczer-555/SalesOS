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

  const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { emailAddress } = await profileRes.json();

  const raw = buildRawEmail({ from: emailAddress, to, cc, bcc, subject, body, attachments });

  const draftRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!draftRes.ok) {
    const err = await draftRes.json();
    return NextResponse.json({ error: err.error?.message ?? "Échec du brouillon" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
