import { runProspectingTick } from "../../lib/prospecting/engine/tick";

// Background function : un tick du moteur Prospecting (lease par boîte,
// réconciliation, synchro des réponses, classification, envoi des étapes dues).
// Budget interne 11 min (runtime Background ~15 min).
//
// Auth : Bearer CRON_SECRET (cron prospecting-tick-scheduled ou
// /api/prospecting/admin/tick). Body : { userId?, dryRun? }
const handler = async (req: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { userId?: string; dryRun?: boolean } = {};
  try {
    body = (await req.json()) as { userId?: string; dryRun?: boolean };
  } catch {
    body = {};
  }

  try {
    const summary = await runProspectingTick({
      userId: typeof body.userId === "string" && body.userId ? body.userId : undefined,
      dryRun: body.dryRun === true,
    });
    const { results, ...head } = summary;
    console.log("[prospecting-tick-background] done:", JSON.stringify({ ...head, mailboxes: results.length }));
    if (summary.errors.length) console.error("[prospecting-tick-background] errors:", summary.errors.slice(0, 20).join(" | "));
  } catch (e) {
    console.error("[prospecting-tick-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};

export default handler;
