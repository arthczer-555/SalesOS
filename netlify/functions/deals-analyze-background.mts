import { runAndPersistDealAnalysis } from "../../lib/deals/run-analysis";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[deals-analyze-bg] unauthorized");
    return;
  }

  let dealId: string | undefined;
  let userId: string | null = null;
  try {
    const body = (await req.json()) as { dealId?: string; userId?: string | null };
    dealId = body.dealId;
    userId = body.userId ?? null;
  } catch {
    console.error("[deals-analyze-bg] invalid JSON body");
    return;
  }

  if (!dealId) {
    console.error("[deals-analyze-bg] missing dealId");
    return;
  }

  const result = await runAndPersistDealAnalysis(dealId, userId);
  if (!result.ok) {
    console.error(`[deals-analyze-bg] ${dealId} failed:`, result.error);
  } else {
    console.log(`[deals-analyze-bg] ${dealId} done`);
  }
};
