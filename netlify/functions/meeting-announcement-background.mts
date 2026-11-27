// Traitement de fond d'une annonce de #1y-new-meetings (analyse IA, proposition,
// réponses du fil, ✅ / ❌). Déclenchée par app/api/slack/events/route.ts (qui
// répond à Slack en moins de 3 s) et par meeting-announcements-scheduled.
import { processAnnouncement } from "../../lib/meetings/process";

export const config = { type: "background" };

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[meeting-announcement-bg] unauthorized");
    return;
  }
  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    console.error("[meeting-announcement-bg] invalid JSON body");
    return;
  }
  if (!body.id) {
    console.error("[meeting-announcement-bg] missing id");
    return;
  }
  try {
    await processAnnouncement(body.id);
  } catch (e) {
    console.error(`[meeting-announcement-bg] ${body.id} failed:`, e instanceof Error ? e.message : e);
  }
};
