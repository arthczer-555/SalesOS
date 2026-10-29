import { runAndPersistLossAnalysis } from "../../lib/deals/run-loss-analysis";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[deals-loss-analyze-bg] unauthorized");
    return;
  }

  let dealId: string | undefined;
  let userId: string | null = null;
  try {
    const body = (await req.json()) as { dealId?: string; userId?: string | null };
    dealId = body.dealId;
    userId = body.userId ?? null;
  } catch {
    console.error("[deals-loss-analyze-bg] invalid JSON body");
    return;
  }

  if (!dealId) {
    console.error("[deals-loss-analyze-bg] missing dealId");
    return;
  }

  const result = await runAndPersistLossAnalysis(dealId, userId);
  if (!result.ok) {
    console.error(`[deals-loss-analyze-bg] ${dealId} failed:`, result.error);
  } else {
    console.log(`[deals-loss-analyze-bg] ${dealId} done`);
  }
};
