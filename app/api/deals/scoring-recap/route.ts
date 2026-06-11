import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { buildAndSendScoringRecap } from "@/lib/deals/scoring-recap";

export const dynamic = "force-dynamic";

// Déclenché en fin de run de scoring (netlify/functions/score-deals-background.mts,
// après la route ae-digest) ou manuellement par un admin connecté. Poste le recap
// du scoring dans #11-everything-prospects et seed le thread Q&A. Déterministe
// (pas de LLM) : reste largement sous le cap ~26s des fonctions sync Netlify.
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && cronHeader === cronSecret;

  if (!isCron) {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const result = await buildAndSendScoringRecap();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
