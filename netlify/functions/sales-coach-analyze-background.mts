import { runSalesCoachAnalysis } from "../../lib/sales-coach/run-analysis";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[sales-coach-analyze-bg] unauthorized");
    return;
  }

  let id: string | undefined;
  let transcriptUrl: string | undefined;
  try {
    const body = (await req.json()) as { id?: string; transcriptUrl?: string };
    id = body.id;
    transcriptUrl = body.transcriptUrl;
  } catch {
    console.error("[sales-coach-analyze-bg] invalid JSON body");
    return;
  }

  if (!id || !transcriptUrl) {
    console.error("[sales-coach-analyze-bg] missing id or transcriptUrl");
    return;
  }

  const result = await runSalesCoachAnalysis(id, transcriptUrl);
  if (!result.ok) {
    console.error(`[sales-coach-analyze-bg] ${id} failed:`, result.error);
  } else if ("already" in result) {
    console.log(`[sales-coach-analyze-bg] ${id} already ${result.already}`);
  } else if ("skipped" in result) {
    console.log(`[sales-coach-analyze-bg] ${id} skipped: ${result.skipped}`);
  } else {
    console.log(`[sales-coach-analyze-bg] ${id} done, score=${result.scoreGlobal}`);
  }
};
