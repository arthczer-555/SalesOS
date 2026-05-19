import { NextRequest, NextResponse } from "next/server";
import { authenticateCronOrUser } from "@/lib/cron-auth";
import { runFundingAgent } from "@/lib/intel/agents/funding";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Route sync utilisée en local (next dev) et comme fallback. En prod Netlify
// le scan dépasse les ~26s sync : le wrapper /api/intel/agents/[id]/run et
// intel-weekly-scan-background.mts dispatchent vers intel-funding-background.
export async function POST(req: NextRequest) {
  const auth = await authenticateCronOrUser(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const result = await runFundingAgent({ callerUserId: auth.userId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
