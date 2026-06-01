import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { buildAndSendAeDigests } from "@/lib/deals/ae-digest";

export const dynamic = "force-dynamic";
// Fetch HubSpot + 1 appel LLM par AE + envois Slack -> on laisse de la marge.
export const maxDuration = 300;

// Déclenché en fin de run de scoring (netlify/functions/score-deals-background.mts)
// ou manuellement par un admin connecté. Envoie un DM "deal review" par AE.
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && cronHeader === cronSecret;

  if (!isCron) {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const result = await buildAndSendAeDigests();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
