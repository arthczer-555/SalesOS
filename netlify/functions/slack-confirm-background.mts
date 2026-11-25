// Traite une réponse ✅ / ❌ à une demande de confirmation Slack (bascule HubSpot
// du 30/11). Déclenchée par app/api/slack/events/route.ts, qui doit répondre à
// Slack en moins de 3 s : le déplacement de la carte et l'écriture du score
// (lectures et écritures HubSpot) se font ici.
import { processCardConfirmation } from "../../lib/sales-coach/card-flow";

export const config = { type: "background" };

type Payload = { channel?: string; ts?: string; answer?: "yes" | "no"; slackUserId?: string };

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[slack-confirm-bg] unauthorized");
    return;
  }
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    console.error("[slack-confirm-bg] invalid JSON body");
    return;
  }
  if (!body.channel || !body.ts || !body.slackUserId || (body.answer !== "yes" && body.answer !== "no")) {
    console.error("[slack-confirm-bg] missing fields");
    return;
  }
  const res = await processCardConfirmation({ channel: body.channel, ts: body.ts, answer: body.answer, slackUserId: body.slackUserId });
  console.log(`[slack-confirm-bg] ${body.channel}/${body.ts} ${body.answer}: ${res.ok ? "ok" : "refused"} - ${res.message.slice(0, 200)}`);
};
