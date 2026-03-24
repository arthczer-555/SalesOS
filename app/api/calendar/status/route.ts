import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ connected: false });

    const accessToken = await getGmailAccessToken(user.id);

    // Test the Calendar API with a minimal call
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.ok) return NextResponse.json({ connected: true });

    const body = await res.json().catch(() => ({}));
    const msg: string = body?.error?.message ?? "";
    if (res.status === 403 || msg.toLowerCase().includes("scope")) {
      return NextResponse.json({ connected: false, reason: "scope_missing" });
    }
    return NextResponse.json({ connected: false, reason: "error" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Gmail non connecté")) {
      return NextResponse.json({ connected: false, reason: "not_connected" });
    }
    return NextResponse.json({ connected: false, reason: "error" });
  }
}
