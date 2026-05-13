import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runLinkedinScan } from "@/lib/intel/run-linkedin-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/linkedin/weekly-scan
// Auth: logged-in user OR CRON_SECRET
// Params: { companiesLimit?: number, keywordsLimit?: number }
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let callerUserId: string | null = null;
    if (!isCron) {
      const user = await getAuthenticatedUser();
      if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
      callerUserId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const result = await runLinkedinScan({
      companiesLimit: body.companiesLimit,
      keywordsLimit: body.keywordsLimit,
      callerUserId,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[linkedin/weekly-scan] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
