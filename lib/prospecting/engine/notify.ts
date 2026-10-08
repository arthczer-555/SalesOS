// Notifications Slack du moteur (DM au rep). Best-effort : un échec Slack ne
// doit jamais casser le tick.
import { db } from "@/lib/db";
import { dmRecipient, lookupSlackIdByEmail } from "@/lib/slack/lookup";
import { errMessage } from "../store/util";

export async function notifyRep(userId: string, text: string): Promise<boolean> {
  if (!process.env.SLACK_BOT_TOKEN) return false;
  try {
    const { data } = await db.from("users").select("slack_user_id, email").eq("id", userId).maybeSingle();
    const row = data as { slack_user_id: string | null; email: string | null } | null;
    const memberId = row?.slack_user_id || (row?.email ? await lookupSlackIdByEmail(row.email) : null);
    if (!memberId) return false;
    await dmRecipient(memberId, text);
    return true;
  } catch (e) {
    console.error("[prospecting] slack DM failed:", errMessage(e));
    return false;
  }
}
