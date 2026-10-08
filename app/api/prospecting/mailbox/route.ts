import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isValidTimezone, MAILBOX_HARD_MAX } from "@/lib/prospecting/settings";
import { getMailboxHealth, updateMailbox } from "@/lib/prospecting/store/mailbox";
import type { MailboxProvider } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ health: await getMailboxHealth(user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Mailbox unavailable" }, { status: 500 });
  }
}

// PATCH : nom d'expéditeur, fuseau, limite quotidienne, pause manuelle, boîte utilisée.
export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    fromName?: string;
    timezone?: string;
    dailyLimit?: number;
    paused?: boolean;
    provider?: MailboxProvider;
  };
  const patch: Parameters<typeof updateMailbox>[1] = {};
  if (typeof body.fromName === "string") patch.from_name = body.fromName.trim().slice(0, 80) || null;
  if (typeof body.timezone === "string" && isValidTimezone(body.timezone)) patch.timezone = body.timezone;
  if (typeof body.dailyLimit === "number" && Number.isFinite(body.dailyLimit)) {
    patch.daily_limit = Math.min(MAILBOX_HARD_MAX, Math.max(1, Math.round(body.dailyLimit)));
  }
  if (body.paused === true) {
    patch.status = "paused";
    patch.paused_reason = "manual";
    patch.paused_until = null;
  } else if (body.paused === false) {
    patch.status = "active";
    patch.paused_reason = null;
    patch.paused_until = null;
  }
  if (body.provider === "gmail" || body.provider === "gmail_sender") patch.provider = body.provider;
  try {
    await updateMailbox(user.id, patch);
    return NextResponse.json({ health: await getMailboxHealth(user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not update the mailbox" }, { status: 500 });
  }
}
