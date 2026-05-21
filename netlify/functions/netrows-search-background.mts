import { runNetrowsSearch } from "../../lib/intel/run-netrows-search";
import type { NetrowsCriteria } from "../../lib/intel-types";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[netrows-search-bg] unauthorized");
    return;
  }

  let jobId: string | undefined;
  let criteria: NetrowsCriteria | undefined;
  try {
    const body = (await req.json()) as { jobId?: string; criteria?: NetrowsCriteria };
    jobId = body.jobId;
    criteria = body.criteria;
  } catch {
    console.error("[netrows-search-bg] invalid JSON body");
    return;
  }

  if (!jobId || !criteria) {
    console.error("[netrows-search-bg] missing jobId or criteria");
    return;
  }

  try {
    await runNetrowsSearch(jobId, criteria);
    console.log(`[netrows-search-bg] ${jobId} done`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[netrows-search-bg] ${jobId} failed:`, msg);
  }
};
