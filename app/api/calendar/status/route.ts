import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ connected: false });

    const accessToken = await getGmailAccessToken(user.id);

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.ok) return NextResponse.json({ connected: true });

    const body = await res.json().catch(() => ({}));
    const msg: string = body?.error?.message ?? "";

    // API not enabled in Google Cloud Console
    if (msg.toLowerCase().includes("disabled") || msg.toLowerCase().includes("has not been used")) {
      return NextResponse.json({ connected: false, reason: "api_not_enabled", detail: msg });
    }
    // Scope / permission issue
    if (res.status === 403 || msg.toLowerCase().includes("scope") || msg.toLowerCase().includes("insufficient")) {
      return NextResponse.json({ connected: false, reason: "scope_missing", detail: msg });
    }
    return NextResponse.json({ connected: false, reason: "error", detail: msg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Gmail non connecté")) {
      return NextResponse.json({ connected: false, reason: "not_connected" });
    }
    return NextResponse.json({ connected: false, reason: "error", detail: msg });
  }
}
